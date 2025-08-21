// API: /api/showbox?tmdb={id}
// Translated from the provided Python script: fetch TMDB movie data, construct ShowBox URL,
// poll it for up to 20s (every 3s) until JSON is returned, then respond with the JSON and metadata.

const TMDB_API_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI2ZWFjNjM1ODA4YmRjMDJkZjI2ZDMwMjk0MGI0Y2EzNyIsIm5iZiI6MTc0ODY4NTIxNy43Mjg5OTk5LCJzdWIiOiI2ODNhZDFhMTkyMWI4N2IxYzk1Mzc4ODQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.w-oWdRIxwlXKTpP42Yo87Mld5sqp8uNFpDHgrqB6a3U';

// In-memory job store for background scraping results (simple, non-persistent)
const scrapingJobs = new Map();

async function getMovieData(tmdb_id) {
    const url = `https://api.themoviedb.org/3/movie/${tmdb_id}?language=en-US`;
    const headers = {
        accept: 'application/json',
        Authorization: `Bearer ${TMDB_API_TOKEN}`
    };

    const res = await fetch(url, { headers });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`TMDB error ${res.status}`);
        err.status = res.status;
        err.body = text;
        throw err;
    }
    return res.json();
}

function constructShowboxLink(title, runtime, release_date) {
    const year = release_date ? String(release_date).split('-')[0] : '';
    const safeTitle = encodeURIComponent(title || '');
    return `https://showbox-five.vercel.app/api/scrape?title=${safeTitle}&year=${year}&rt=${runtime || 0}&type=1`;
}

async function fetchShowboxJson(url, timeout = 20000, interval = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 10000);
            let res;
            try {
                res = await fetch(url, { signal: controller.signal });
            } finally {
                clearTimeout(t);
            }

            if (res && res.ok) {
                // attempt to parse JSON; if not JSON yet, continue polling
                try {
                    const json = await res.json();
                    return json;
                } catch (e) {
                    // not JSON yet
                }
            }
        } catch (e) {
            // network or abort; ignore and retry until timeout
        }

        // wait interval before next try
        await new Promise(r => setTimeout(r, interval));
    }
    return null;
}

export default async function handler(req, res) {
        const tmdb = req.query.tmdb || req.query.id || req.query.movie || '';
        if (!tmdb) return res.status(400).json({ error: 'Missing tmdb query parameter' });

        // Polling/status API: return scraping result or start background job
        if (req.query.poll === '1' || req.query.status === '1') {
                let job = scrapingJobs.get(String(tmdb));
                if (!job) {
                        // Start background scraping job and return started state
                        job = { status: 'pending', startedAt: Date.now() };
                        scrapingJobs.set(String(tmdb), job);
                        (async () => {
                                try {
                                        const movie = await getMovieData(String(tmdb));
                                        const title = movie.title || movie.original_title || '';
                                        const runtime = typeof movie.runtime === 'number' ? movie.runtime : 0;
                                        const release_date = movie.release_date || '';
                                        const showbox_link = constructShowboxLink(title, runtime, release_date);

                                        const json = await fetchShowboxJson(showbox_link, 20000, 3000);

                                        if (!json) {
                                                job.status = 'error';
                                                job.error = 'Failed to retrieve showbox JSON';
                                                return;
                                        }

                                        const qualitiesPerServer = {};
                                        Object.keys(json).forEach(server => {
                                                const arr = Array.isArray(json[server]) ? json[server] : [];
                                                qualitiesPerServer[server] = arr.map(item => ({ quality: item.quality, link: item.link }));
                                        });

                                        let defaultLink = null;
                                        for (const server of Object.keys(qualitiesPerServer)) {
                                                const found = qualitiesPerServer[server].find(q => String(q.quality).toUpperCase() === 'ORG');
                                                if (found && found.link) { defaultLink = found.link; break; }
                                        }
                                        if (!defaultLink) {
                                                for (const server of Object.keys(qualitiesPerServer)) {
                                                        const found = qualitiesPerServer[server].find(q => String(q.quality).toUpperCase().includes('1080'));
                                                        if (found && found.link) { defaultLink = found.link; break; }
                                                }
                                        }
                                        if (!defaultLink) {
                                                outer: for (const server of Object.keys(qualitiesPerServer)) {
                                                        for (const q of qualitiesPerServer[server]) {
                                                                if (q.link) { defaultLink = q.link; break outer; }
                                                        }
                                                }
                                        }

                                        // Fetch subtitles (best-effort)
                                        let subtitles = [];
                                        try {
                                                const subRes = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`);
                                                if (subRes.ok) subtitles = await subRes.json();
                                        } catch (e) {}

                                        job.status = 'done';
                                        job.data = {
                                                streamUrl: defaultLink || '',
                                                qualities: qualitiesPerServer,
                                                subtitles,
                                                title: title || ''
                                        };
                                } catch (e) {
                                        job.status = 'error';
                                        job.error = e && e.message ? e.message : String(e);
                                }
                        })();

                        return res.json({ started: true, ready: false });
                }

                // If job exists, return its status
                if (job.status === 'done') {
                        return res.json({ ready: true, ...(job.data || {}) });
                }
                if (job.status === 'error') {
                        return res.status(500).json({ ready: false, error: job.error || 'scrape_error' });
                }
                return res.json({ ready: false, started: true });
        }

        // Normal page request: respond immediately with the player page and a loading overlay
        try {
                // Try to fetch minimal movie metadata to show a title quickly
                let title = '';
                try {
                        const movie = await getMovieData(String(tmdb));
                        title = movie.title || movie.original_title || '';
                } catch (e) {
                        // ignore metadata errors; page will still render
                }

                const { serveHtml } = await import('./shared/html');

                // Build a loading overlay (adapted popup) that polls this endpoint for status
                const overlay = `
<div id="showbox-overlay" class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
    <div class="relative w-full max-w-md overflow-hidden rounded-2xl bg-gradient-to-br from-black to-gray-900 shadow-2xl transition-all duration-500 hover:shadow-[0_0_50px_rgba(0,153,255,0.15)] flex flex-col">
        <div class="absolute inset-0 bg-gradient-to-br from-[#0099ff]/5 via-transparent to-purple-500/5"></div>
        <div class="absolute inset-0 bg-gradient-radial"></div>
        <div class="absolute inset-0 rounded-2xl bg-gradient-border p-px"><div class="h-full w-full rounded-2xl bg-gradient-to-br from-black to-gray-900"></div></div>
        <div class="relative p-8 pb-6 flex-shrink-0">
            <div class="flex items-center justify-between mb-6">
                <h2 class="bg-gradient-to-r from-[#0099ff] to-cyan-400 bg-clip-text text-2xl font-bold text-transparent tracking-wide">Scraping ShowBox</h2>
                <div id="progress-badge" class="rounded-full bg-[#0099ff]/10 px-3 py-1 text-sm text-[#0099ff] font-medium backdrop-blur-sm">Processing</div>
            </div>
            <div class="h-px bg-gradient-to-r from-transparent via-white/30 to-transparent shadow-sm"></div>
        </div>
        <div class="relative flex-1 px-8 pb-8">
            <div class="flex flex-col items-center justify-center">
                <div class="w-20 h-20 rounded-full bg-gradient-to-br from-[#0099ff] to-cyan-400 flex items-center justify-center mb-6">
                    <svg class="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                </div>
                <h3 class="text-xl font-bold text-[#0099ff] mb-2">ShowBox</h3>
                <div id="status-indicator" class="flex items-center gap-2 rounded-full bg-[#0099ff]/10 px-4 py-2 mb-6">
                    <svg id="status-spinner" class="h-4 w-4 animate-spin text-[#0099ff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    <span id="status-text" class="text-sm text-[#0099ff] font-medium">Processing</span>
                </div>
                <div class="w-full mb-4">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-sm text-gray-400">Scraping progress</span>
                        <span id="progress-percentage" class="text-sm font-medium text-[#0099ff]">0%</span>
                    </div>
                    <div class="w-full bg-gray-700/50 rounded-full h-2.5">
                        <div id="progress-bar" class="bg-gradient-to-r from-[#0099ff] to-cyan-400 h-2.5 rounded-full transition-all duration-500" style="width: 0%"></div>
                    </div>
                </div>
                <p class="text-xs text-gray-400 text-center mt-6">Please wait 20-30 seconds. If unsuccessful, please try again as the scraper can sometimes experience issues.</p>
            </div>
        </div>
    </div>
    <script>
        (function(){
            const progressBar = document.getElementById('progress-bar');
            const progressPercentage = document.getElementById('progress-percentage');
            const progressBadge = document.getElementById('progress-badge');
            const statusIndicator = document.getElementById('status-indicator');
            const statusSpinner = document.getElementById('status-spinner');
            const statusText = document.getElementById('status-text');
            const overlay = document.getElementById('showbox-overlay');
            let progress = 0;
            let pollInterval = null;
            const tmdb = ${JSON.stringify(String(tmdb))};

            function updateProgress(p){ progressBar.style.width = p + '%'; progressPercentage.textContent = Math.round(p) + '%'; }
            function updateStatusText(text){ progressBadge.textContent = text; statusText.textContent = text; }

            // Start fake progress
            updateProgress(0);
            updateStatusText('Processing');
            const progressTimer = setInterval(()=>{
                progress = Math.min(100, progress + (6 + Math.random()*12));
                updateProgress(progress);
                if(progress >= 98) clearInterval(progressTimer);
            }, 2500);

            // Poll server for result. This will also cause the server to start scraping on first poll.
            async function poll(){
                try{
                    const res = await fetch('/api/showbox?tmdb=' + encodeURIComponent(tmdb) + '&poll=1');
                    if(!res.ok){
                        // Keep polling but show failed state if persistent
                        return;
                    }
                    const j = await res.json();
                    if(j.ready){
                        clearInterval(pollInterval);
                        clearInterval(progressTimer);
                        updateProgress(100);
                        updateStatusText('Complete');

                        // Inject player variables and notify the player to load
                        try{
                            if(j.streamUrl) window.source = j.streamUrl;
                            if(j.subtitles) window.__SUBTITLES__ = j.subtitles;
                            if(j.qualities) window.__QUALITIES__ = j.qualities;
                            if(j.title) window.__PLAYER_TITLE__ = j.title;
                            // Notify player script
                            window.dispatchEvent(new Event('source-ready'));
                        }catch(e){}

                        // Hide overlay and try autoplay after a short delay
                        setTimeout(()=>{
                            if(overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                            try{ const v = document.querySelector('video'); if(v){ v.play().catch(()=>{}); } }catch(e){}
                        }, 600);
                    }
                }catch(e){
                    // ignore and retry
                }
            }
            pollInterval = setInterval(poll, 2000);
            // Kickstart immediately
            poll();
        })();
    </script>
</div>
                `;

                return serveHtml(res, 'index.html', { loadingOverlay: overlay, pageTitle: title || 'ShowBox' });
        } catch (e) {
                const status = e && e.status ? e.status : 500;
                const body = e && e.body ? e.body : undefined;
                return res.status(status).json({ error: e.message || 'Unknown error', details: body });
        }
}
