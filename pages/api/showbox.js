// API: /api/showbox?tmdb={id}
// Translated from the provided Python script: fetch TMDB movie data, construct ShowBox URL,
// poll it for up to 20s (every 3s) until JSON is returned, then respond with the JSON and metadata.

const TMDB_API_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI2ZWFjNjM1ODA4YmRjMDJkZjI2ZDMwMjk0MGI0Y2EzNyIsIm5iZiI6MTc0ODY4NTIxNy43Mjg5OTk5LCJzdWIiOiI2ODNhZDFhMTkyMWI4N2IxYzk1Mzc4ODQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.w-oWdRIxwlXKTpP42Yo87Mld5sqp8uNFpDHgrqB6a3U';

import { setProgress, getProgress, clearProgress } from './shared/progress';

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

    // SSE progress endpoint
    if (req.query.progress && tmdb) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders && res.flushHeaders();
        let state = getProgress(tmdb);
        res.write(`data: ${JSON.stringify(state)}\n\n`);
        const interval = setInterval(() => {
            state = getProgress(tmdb);
            if (state) {
                res.write(`data: ${JSON.stringify(state)}\n\n`);
                if (state.found !== null || (state.statuses && state.statuses.every(s => s === 'completed' || s === 'error'))) {
                    clearInterval(interval);
                    res.end();
                }
            }
        }, 1000);
        req.on('close', () => clearInterval(interval));
        return;
    }

    try {
        const movie = await getMovieData(String(tmdb));
        const title = movie.title || movie.original_title || '';
        const runtime = typeof movie.runtime === 'number' ? movie.runtime : 0;
        const release_date = movie.release_date || '';

        const showbox_link = constructShowboxLink(title, runtime, release_date);

        // Loading overlay with SSE client that will apply the stream when ready
        const loadingOverlay = `\n<div id="loading-overlay" class="fixed inset-0 flex items-center justify-center bg-black bg-opacity-80 z-50">\n  <div class="flex flex-col items-center">\n    <svg class="animate-spin h-10 w-10 text-white mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>\n    <span id=\"please-wait-text\" class="text-white text-sm font-semibold">Please wait up to 30 seconds while we prepare the stream...</span>\n  </div>\n</div>\n<script>\n(function(){\n  function hideOverlay(){ const overlay=document.getElementById('loading-overlay'); if(overlay) overlay.style.display='none'; }\n  function onFound(found){ try{ if(found.streamUrl){ window.source = found.streamUrl; window.__QUALITIES__ = found.qualities || null; window.__SUBTITLES__ = found.subtitles || null; window.__PLAYER_TITLE__ = found.pageTitle || ''; window.dispatchEvent(new Event('source-ready')); } }catch(e){} }\n  if (window.source) { hideOverlay(); } else {\n    const evt = new EventSource('/api/showbox?tmdb=${encodeURIComponent(tmdb)}&progress=1');\n    evt.onmessage = function(ev){ try{ const data = JSON.parse(ev.data); if (data && data.found) { onFound(data.found); hideOverlay(); evt.close(); } else if (data && Array.isArray(data.statuses) && data.statuses.every(s=>s==='completed' || s==='error')) { // finished but no stream\n        const txt = document.getElementById('please-wait-text'); if(txt) txt.textContent = 'No stream found.'; evt.close();\n      } } catch(e){} };\n    window.addEventListener('source-ready', hideOverlay);\n    setTimeout(()=>{ const txt=document.getElementById('please-wait-text'); if(txt) txt.textContent='Still preparing the stream — you can keep this page open.'; },30000);\n  }\n})();\n</script>\n`;

        const { serveHtml } = await import('./shared/html');

        // Initialize progress and start background polling (non-blocking)
        setProgress(tmdb, ['pending'], null);
        (async () => {
            try {
                const json = await fetchShowboxJson(showbox_link, 30000, 3000);
                if (!json) {
                    setProgress(tmdb, ['error'], null);
                    setTimeout(()=>clearProgress(tmdb), 60000);
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
                let subtitles = [];
                try { const subRes = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`); if (subRes.ok) subtitles = await subRes.json(); } catch(e){}

                setProgress(tmdb, ['completed'], { streamUrl: defaultLink || '', qualities: qualitiesPerServer, pageTitle: title, subtitles });
                setTimeout(()=>clearProgress(tmdb), 60000);
            } catch (e) {
                setProgress(tmdb, ['error'], null);
                setTimeout(()=>clearProgress(tmdb), 60000);
            }
        })();

        // Serve page immediately
        return serveHtml(res, 'index.html', { loadingOverlay, pageTitle: title });
    } catch (e) {
        const status = e && e.status ? e.status : 500;
        const body = e && e.body ? e.body : undefined;
        return res.status(status).json({ error: e.message || 'Unknown error', details: body });
    }
}
