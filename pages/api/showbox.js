// API: /api/showbox
// New behavior:
// - GET /api/showbox?tmdb=... -> serves an immediate HTML popup that shows fake progress and
//   asynchronously calls back to this same endpoint with ?action=scrape to perform scraping.
// - GET /api/showbox?action=scrape&tmdb=... -> performs the server-side scraping (calls the
//   external ShowBox scraper) and returns JSON with `defaultLink`, `qualities`, and `title`.

const TMDB_API_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI2ZWFjNjM1ODA4YmRjMDJkZjI2ZDMwMjk0MGI0Y2EzNyIsIm5iZiI6MTc0ODY4NTIxNy43Mjg5OTk5LCJzdWIiOiI2ODNhZDFhMTkyMWI4N2IxYzk1Mzc4ODQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.w-oWdRIxwlXKTpP42Yo87Mld5sqp8uNFpDHgrqB6a3U';

async function getMovieData(tmdb_id, type = 'movie') {
        const base = type === 'tv' ? 'tv' : 'movie';
        const url = `https://api.themoviedb.org/3/${base}/${tmdb_id}?language=en-US`;
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

// Helper to normalize qualities and pick default link
function normalizeQualitiesAndPickDefault(json) {
        const qualitiesPerServer = {};
        Object.keys(json || {}).forEach(server => {
                const arr = Array.isArray(json[server]) ? json[server] : [];
                qualitiesPerServer[server] = arr.map(item => ({ quality: item.quality, link: item.link }));
        });

        let defaultLink = null;
        // prefer ORG
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

        return { qualitiesPerServer, defaultLink };
}

export default async function handler(req, res) {
        // If action=scrape, perform scraping and return JSON immediately
        const action = req.query.action || '';
        const tmdb = req.query.tmdb || req.query.id || req.query.movie || '';
        const type = (req.query.type === 'tv' || req.query.tv) ? 'tv' : 'movie';
        const season = req.query.s || req.query.season || 1;
        const episode = req.query.e || req.query.episode || 1;

        if (action === 'scrape') {
                if (!tmdb) return res.status(400).json({ error: 'Missing tmdb query parameter' });
                try {
                        const movie = await getMovieData(String(tmdb), type);
                        const title = movie.title || movie.name || movie.original_title || '';
                        const runtime = typeof movie.runtime === 'number' ? movie.runtime : (movie.episode_run_time && movie.episode_run_time[0]) || 0;
                        const release_date = movie.release_date || movie.first_air_date || '';

                        const showbox_link = constructShowboxLink(title, runtime, release_date);

                        const json = await fetchShowboxJson(showbox_link, 20000, 3000);
                        if (!json) {
                                return res.status(502).json({ error: 'Failed to retrieve showbox JSON' });
                        }

                        const { qualitiesPerServer, defaultLink } = normalizeQualitiesAndPickDefault(json);

                        // Fetch subtitles (best-effort)
                        let subtitles = [];
                        try {
                                const subRes = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`);
                                if (subRes.ok) subtitles = await subRes.json();
                        } catch (e) {}

                        return res.json({ ok: true, defaultLink: defaultLink || null, qualities: qualitiesPerServer, title, subtitles });
                } catch (e) {
                        const status = e && e.status ? e.status : 500;
                        const body = e && e.body ? e.body : undefined;
                        return res.status(status).json({ error: e.message || 'Unknown error', details: body });
                }
        }

        // Otherwise, serve the popup HTML that shows fake progress and calls the scrape action
        // Note: escape template placeholders in the HTML by using \${ to avoid server interpolation
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
            <!-- Background effects -->
            <div class="absolute inset-0 bg-gradient-to-br from-[#0099ff]/5 via-transparent to-purple-500/5"></div>
            <div class="absolute inset-0 bg-gradient-radial"></div>
      
            <!-- Border glow -->
            <div class="absolute inset-0 rounded-2xl bg-gradient-border p-px">
                <div class="h-full w-full rounded-2xl bg-gradient-to-br from-black to-gray-900"></div>
            </div>

            <!-- Header -->
            <div class="relative p-8 pb-6 flex-shrink-0">
                <div class="flex items-center justify-between mb-6">
                    <h2 class="bg-gradient-to-r from-[#0099ff] to-cyan-400 bg-clip-text text-2xl font-bold text-transparent tracking-wide">
                        Scraping ShowBox
                    </h2>
                    <div id="progress-badge" class="rounded-full bg-[#0099ff]/10 px-3 py-1 text-sm text-[#0099ff] font-medium backdrop-blur-sm">
                        Processing
                    </div>
                </div>
                <div class="h-px bg-gradient-to-r from-transparent via-white/30 to-transparent shadow-sm"></div>
            </div>

            <!-- Main content -->
            <div class="relative flex-1 px-8 pb-8">
                <div class="flex flex-col items-center justify-center">
                    <!-- Provider icon/logo -->
                    <div class="w-20 h-20 rounded-full bg-gradient-to-br from-[#0099ff] to-cyan-400 flex items-center justify-center mb-6">
                        <svg class="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <line x1="9" y1="3" x2="9" y2="21"></line>
                        </svg>
                    </div>
          
                    <!-- Provider name -->
                    <h3 class="text-xl font-bold text-[#0099ff] mb-2">ShowBox</h3>
          
                    <!-- Status with spinner -->
                    <div id="status-indicator" class="flex items-center gap-2 rounded-full bg-[#0099ff]/10 px-4 py-2 mb-6">
                        <svg id="status-spinner" class="h-4 w-4 animate-spin text-[#0099ff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        <span id="status-text" class="text-sm text-[#0099ff] font-medium">Processing</span>
                    </div>
          
                    <!-- Progress section -->
                    <div class="w-full mb-4">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-sm text-gray-400">Scraping progress</span>
                            <span id="progress-percentage" class="text-sm font-medium text-[#0099ff]">0%</span>
                        </div>
                        <div class="w-full bg-gray-700/50 rounded-full h-2.5">
                            <div id="progress-bar" class="bg-gradient-to-r from-[#0099ff] to-cyan-400 h-2.5 rounded-full transition-all duration-500" style="width: 0%"></div>
                        </div>
                    </div>
          
                    <!-- Info text -->
                    <p class="text-xs text-gray-400 text-center mt-6">
                        Please wait 20-30 seconds. If unsuccessful, please try again as the scraper can sometimes experience issues.
                    </p>
                </div>
            </div>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const progressBar = document.getElementById('progress-bar');
            const progressPercentage = document.getElementById('progress-percentage');
            const progressBadge = document.getElementById('progress-badge');
            const statusIndicator = document.getElementById('status-indicator');
            const statusSpinner = document.getElementById('status-spinner');
            const statusText = document.getElementById('status-text');
      
            let foundStream = null;
            let tmdb = null;
            let season = 1;
            let episode = 1;
            let apiType = 'movie';
            let showBoxInterval = null;
            let scraping = false;
      
            // Try to get tmdb, s, e, type param from URL
            try {
                const urlParams = new URLSearchParams(window.location.search);
                tmdb = urlParams.get('tmdb');
                season = urlParams.get('s') ? parseInt(urlParams.get('s'), 10) : 1;
                episode = urlParams.get('e') ? parseInt(urlParams.get('e'), 10) : 1;
                if (urlParams.get('type') === 'tv') {
                    apiType = 'tv';
                } else if ((urlParams.has('s') || urlParams.has('e')) && !urlParams.get('type')) {
                    apiType = 'tv';
                }
                if (window.location.pathname.includes('/tv')) {
                    apiType = 'tv';
                }
            } catch (e) {}
      
            function updateProgress(progress) {
                progressBar.style.width = (progress) + '%';
                progressPercentage.textContent = Math.round(progress) + '%';
            }
      
            function updateStatus(status, color) {
                // Update top badge
                progressBadge.textContent = status;
                progressBadge.className = 'rounded-full px-3 py-1 text-sm font-medium backdrop-blur-sm ' + color;
        
                // Update middle status indicator
                statusIndicator.className = 'flex items-center gap-2 rounded-full px-4 py-2 mb-6 ' + color;
        
                // Update text and spinner
                statusText.textContent = status;
        
                // Show or hide spinner based on status
                if (status === 'Processing') {
                    statusSpinner.classList.remove('hidden');
                    statusSpinner.classList.add('animate-spin');
                } else {
                    statusSpinner.classList.add('hidden');
                    statusSpinner.classList.remove('animate-spin');
                }
            }
      
            function startShowBoxProgress() {
                let progress = 0;
                updateProgress(progress);
                updateStatus('Processing', 'bg-[#0099ff]/10 text-[#0099ff]');
        
                clearInterval(showBoxInterval);
                showBoxInterval = setInterval(() => {
                    // only advance fake progress if scraping not completed
                    if (scraping) return;
                    progress += 12; // 100% / 8 intervals ≈ 12.5% per interval
          
                    if (progress >= 100) {
                        progress = 100;
                        clearInterval(showBoxInterval);
            
                        // Update status to completed
                        updateStatus('Complete', 'bg-green-500/10 text-green-600');
            
                        // If scraping already returned a link, redirect now
                        if (foundStream) {
                            showResult(foundStream);
                        }
                    }
          
                    updateProgress(progress);
                }, 3000); // Update every 3 seconds
            }
      
            function showResult(foundUrl) {
                const resultDiv = document.createElement('div');
                resultDiv.className = 'mt-6 p-4 rounded-xl bg-gradient-to-r from-[#0099ff]/10 to-cyan-400/5 text-center';
        
                let streamLink = null;
                if (foundUrl) {
                    streamLink = '/api/stream?url=' + encodeURIComponent(foundUrl) + (tmdb ? '&tmdb=' + encodeURIComponent(tmdb) : '') + (apiType === 'tv' ? '&type=tv&s=' + season + '&e=' + episode : '');
          
                    // Show success message before redirecting
                    resultDiv.innerHTML = "\n            <div class='text-green-400 font-bold mb-2'>Stream Found! Redirecting...</div>\n            <div class='mt-2 text-xs text-[#0099ff]/80 break-all'>" + foundUrl + "</div>\n          ";
                    document.querySelector('.relative.flex-1').appendChild(resultDiv);
          
                    // Automatically redirect to the stream page after a brief delay
                    setTimeout(() => {
                        window.location.href = streamLink;
                    }, 800);
                } else {
                    // Update status to error
                    updateStatus('Failed', 'bg-red-500/10 text-red-600');
          
                    resultDiv.innerHTML = "\n            <div class='text-red-400 font-bold mb-2'>No stream found.</div>\n            <button class=\"mt-3 px-4 py-2 bg-[#0099ff]/20 hover:bg-[#0099ff]/30 text-[#0099ff] rounded-lg transition-colors\" onclick=\"window.location.reload()\">\n              Retry Now\n            </button>\n          ";
                    document.querySelector('.relative.flex-1').appendChild(resultDiv);
                }
            }
      
            async function callScrapeApi() {
                if (!tmdb) return;
                scraping = false;
                const params = new URLSearchParams();
                params.set('action', 'scrape');
                params.set('tmdb', tmdb);
                if (apiType === 'tv') {
                    params.set('type', 'tv');
                    params.set('s', season);
                    params.set('e', episode);
                }
                const url = '/api/showbox?' + params.toString();
                try {
                    // Perform the scrape request but don't block UI; show fake progress while waiting
                    const resp = await fetch(url, { method: 'GET' });
                    if (!resp.ok) {
                        const body = await resp.text().catch(() => '');
                        console.warn('Scrape failed', resp.status, body);
                        showResult(null);
                        return;
                    }
                    const json = await resp.json();
                    if (json && json.defaultLink) {
                        foundStream = json.defaultLink;
                        // If progress already finished, immediately redirect
                        showResult(foundStream);
                    } else {
                        showResult(null);
                    }
                } catch (e) {
                    console.warn('Scrape exception', e);
                    showResult(null);
                }
            }

            startShowBoxProgress();
            // Start scraping in background
            callScrapeApi();
        });
    </script>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(html);
}
