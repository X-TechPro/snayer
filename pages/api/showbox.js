// API: /api/showbox
// This route supports two modes:
//  - HTML popup mode (default): serve a small page that shows a scraping progress UI and polls this same
//    endpoint for JSON results.
//  - JSON/poll mode: when ?poll=1 or ?json=1 is present, run the scraping workflow and return JSON with
//    stream URL and qualities. The client popup will poll this until a result is returned.

const TMDB_API_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI2ZWFjNjM1ODA4YmRjMDJkZjI2ZDMwMjk0MGI0Y2EzNyIsIm5iZiI6MTc0ODY4NTIxNy43Mjg5OTk5LCJzdWIiOiI2ODNhZDFhMTkyMWI4N2IxYzk1Mzc4ODQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.w-oWdRIxwlXKTpP42Yo87Mld5sqp8uNFpDHgrqB6a3U';

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

// Build the small popup HTML (inlined here to avoid touching shared templates).
function buildPopupHtml() {
        return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Scraping ShowBox</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style type="text/tailwindcss">
        @layer utilities {
            .bg-gradient-radial {
                background: radial-gradient(circle at 50% 0%, rgba(0, 153, 255, 0.1), transparent 50%);
            }
            .bg-gradient-border {
                background: linear-gradient(to right, rgba(0, 153, 255, 0.2), transparent, rgba(0, 153, 255, 0.2));
            }
        }
    </style>
</head>
<body class="bg-black text-white h-screen flex justify-center items-center">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
        <div class="relative w-full max-w-md overflow-hidden rounded-2xl bg-gradient-to-br from-black to-gray-900 shadow-2xl transition-all duration-500 hover:shadow-[0_0_50px_rgba(0,153,255,0.15)] flex flex-col">
            <div class="absolute inset-0 bg-gradient-to-br from-[#0099ff]/5 via-transparent to-purple-500/5"></div>
            <div class="absolute inset-0 bg-gradient-radial"></div>
            <div class="absolute inset-0 rounded-2xl bg-gradient-border p-px">
                <div class="h-full w-full rounded-2xl bg-gradient-to-br from-black to-gray-900"></div>
            </div>
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
                        <svg class="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="9" y1="3" x2="9" y2="21"></line>
                        </svg>
                    </div>
                    <h3 class="text-xl font-bold text-[#0099ff] mb-2">ShowBox</h3>
                    <div id="status-indicator" class="flex items-center gap-2 rounded-full bg-[#0099ff]/10 px-4 py-2 mb-6">
                        <svg id="status-spinner" class="h-4 w-4 animate-spin text-[#0099ff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
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
    </div>

    <script>
        (function(){
            const progressBar = document.getElementById('progress-bar');
            const progressPercentage = document.getElementById('progress-percentage');
            const progressBadge = document.getElementById('progress-badge');
            const statusIndicator = document.getElementById('status-indicator');
            const statusSpinner = document.getElementById('status-spinner');
            const statusText = document.getElementById('status-text');

            const urlParams = new URLSearchParams(window.location.search);
            const tmdb = urlParams.get('tmdb') || urlParams.get('id') || '';
            const season = urlParams.get('s') ? parseInt(urlParams.get('s'), 10) : 1;
            const episode = urlParams.get('e') ? parseInt(urlParams.get('e'), 10) : 1;
            let apiType = 'movie';
            if (urlParams.get('type') === 'tv' || urlParams.has('s') || urlParams.has('e') || window.location.pathname.includes('/tv')) apiType = 'tv';

            function updateProgress(p){ progressBar.style.width = p + '%'; progressPercentage.textContent = Math.round(p) + '%'; }
            function updateStatus(text, badgeCss){ progressBadge.textContent = text; statusText.textContent = text; }

            // fake progress growth while we poll the backend
            let progress = 0;
            updateProgress(progress);
            updateStatus('Processing');
            const growInterval = setInterval(()=>{ progress = Math.min(98, progress + (4 + Math.random()*10)); updateProgress(progress); }, 2500);

            // poll backend for real result
            let attempts = 0;
            async function poll(){
                attempts++;
                try{
                    const q = new URLSearchParams(window.location.search);
                    q.set('poll','1');
                    const resp = await fetch(window.location.pathname + '?' + q.toString(), {cache: 'no-store'});
                    if (resp.ok){
                        const data = await resp.json();
                        if (data && data.streamUrl){
                            clearInterval(growInterval);
                            updateProgress(100);
                            updateStatus('Complete');
                            // Redirect to stream handler which will serve player
                                                        const streamLink = '/api/stream?url=' + encodeURIComponent(data.streamUrl)
                                                                + (tmdb ? '&tmdb=' + encodeURIComponent(tmdb) : '')
                                                                + (apiType === 'tv' ? '&type=tv&s=' + season + '&e=' + episode : '');
                            // small delay to show completion
                            setTimeout(()=>{ window.location.href = streamLink; }, 900);
                            return;
                        }
                    }
                }catch(e){/* ignore */}
                // stop after ~30s
                if (attempts > 15) {
                    clearInterval(growInterval);
                    updateStatus('Failed');
                    progressBar.style.width = '100%';
                    progressPercentage.textContent = '100%';
                    // Show a simple retry UI
                    const root = document.querySelector('.relative.flex-1');
                    if (root){
                        const div = document.createElement('div');
                        div.className = 'mt-6 p-4 rounded-xl bg-gradient-to-r from-[#0099ff]/10 to-cyan-400/5 text-center';
                        div.innerHTML = '<div class="text-red-400 font-bold mb-2">No stream found.</div><button class="mt-3 px-4 py-2 bg-[#0099ff]/20 hover:bg-[#0099ff]/30 text-[#0099ff] rounded-lg transition-colors" onclick="window.location.reload()">Retry Now</button>';
                        root.appendChild(div);
                    }
                } else {
                    setTimeout(poll, 2000);
                }
            }

            // start polling after slight delay so the fake progress is visible
            setTimeout(poll, 800);
        })();
    </script>
</body>
</html>`;
}

export default async function handler(req, res) {
        // If client asks for poll/json, run the scraping and return JSON.
        const isPoll = req.query && (req.query.poll === '1' || req.query.json === '1' || req.query.poll === 'true');
        const tmdb = req.query.tmdb || req.query.id || req.query.movie || '';

        if (!tmdb) {
                // If this is not a poll request, still return the popup which expects a tmdb param.
                if (!isPoll) {
                        res.setHeader('Content-Type', 'text/html; charset=utf-8');
                        return res.status(200).send(buildPopupHtml());
                }
                return res.status(400).json({ error: 'Missing tmdb query parameter' });
        }

        if (!isPoll) {
                // serve popup HTML immediately
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                return res.status(200).send(buildPopupHtml());
        }

        // Poll mode: run the original scraping logic and return JSON
        try {
                const movie = await getMovieData(String(tmdb));
                const title = movie.title || movie.original_title || '';
                const runtime = typeof movie.runtime === 'number' ? movie.runtime : 0;
                const release_date = movie.release_date || '';

                const showbox_link = constructShowboxLink(title, runtime, release_date);

                const json = await fetchShowboxJson(showbox_link, 20000, 3000);

                if (!json) {
                        return res.status(502).json({ error: 'Failed to retrieve showbox JSON' });
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

                let subtitles = [];
                try {
                        const subRes = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`);
                        if (subRes.ok) subtitles = await subRes.json();
                } catch (e) {}

                // Return JSON result for the popup client to consume
                return res.status(200).json({
                        streamUrl: defaultLink || '',
                        qualities: qualitiesPerServer,
                        title,
                        subtitles
                });
        } catch (e) {
                const status = e && e.status ? e.status : 500;
                const body = e && e.body ? e.body : undefined;
                return res.status(status).json({ error: e.message || 'Unknown error', details: body });
        }
}
