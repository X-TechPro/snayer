// API: /api/showbox?tmdb={id}
// Translated from the provided Python script: fetch TMDB movie data, construct ShowBox URL,
// poll it for up to 20s (every 3s) until JSON is returned, then respond with the JSON and metadata.

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

export default async function handler(req, res) {
    const tmdb = req.query.tmdb || req.query.id || req.query.movie || '';
    if (!tmdb) return res.status(400).json({ error: 'Missing tmdb query parameter' });

        // Fast path: when the client requests the page normally, serve a lightweight HTML
        // immediately with a small "please wait 30 seconds" overlay and a client-side
        // fetch that will request the same endpoint with &fetch=1 to get the real data.
        // The heavy work (TMDB + Showbox polling) remains unchanged and runs only for
        // the fetch=1 request.
        if (!req.query.fetch) {
                const { serveHtml } = await import('./shared/html');
                const loadingOverlay = `
<div id="please-wait-overlay" style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);color:#fff;z-index:9999;font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;">
    <div style="background:#111;padding:16px 20px;border-radius:8px;text-align:center;min-width:180px;">
        <div style="font-size:16px;margin-bottom:8px;">Please wait 30 seconds</div>
        <div id="please-wait-countdown" style="font-size:12px;opacity:0.9;">30</div>
    </div>
</div>
<script>
(function(){
    var t=30;var el;try{el=document.getElementById('please-wait-countdown');}catch(e){}
    function tick(){ if(el) el.textContent = t; t--; if(t<0) clearInterval(iv); }
    tick(); var iv = setInterval(tick,1000);
    // Ask the server for the real data (heavy work) without blocking initial page load
    fetch(location.pathname + location.search + '&fetch=1').then(function(r){ return r.json(); }).then(function(data){
        try{ if(data.pageTitle) window.__PLAYER_TITLE__ = data.pageTitle; }catch(e){}
        try{ if(data.subtitles) window.__SUBTITLES__ = data.subtitles; }catch(e){}
        try{ if(data.qualities) window.__QUALITIES__ = data.qualities; }catch(e){}
        try{ if(data.streamUrl){ window.source = data.streamUrl; window.dispatchEvent(new Event('source-ready')); } }catch(e){}
        var o=document.getElementById('please-wait-overlay'); if(o) o.parentNode.removeChild(o);
    }).catch(function(){ var o=document.getElementById('please-wait-overlay'); if(o) o.querySelector('div').textContent='Still working...'; });
})();
</script>
                `;
                return serveHtml(res, 'index.html', { loadingOverlay });
        }

    try {
        const movie = await getMovieData(String(tmdb));
        const title = movie.title || movie.original_title || '';
        const runtime = typeof movie.runtime === 'number' ? movie.runtime : 0;
        const release_date = movie.release_date || '';

        const showbox_link = constructShowboxLink(title, runtime, release_date);

        const json = await fetchShowboxJson(showbox_link, 20000, 3000);

        // If we didn't get JSON, return 502
        if (!json) {
            return res.status(502).json({ error: 'Failed to retrieve showbox JSON' });
        }

        // Normalize qualities into an ordered list per server
        // json is expected to be an object with server keys each mapping to an array of {quality, link}
        const qualitiesPerServer = {};
        Object.keys(json).forEach(server => {
            const arr = Array.isArray(json[server]) ? json[server] : [];
            qualitiesPerServer[server] = arr.map(item => ({ quality: item.quality, link: item.link }));
        });

        // Choose default stream: prefer the first ORG quality across servers; else prefer first 1080P; else first available
        let defaultLink = null;
        // Search for ORG
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
            // fallback to first link found
            outer: for (const server of Object.keys(qualitiesPerServer)) {
                for (const q of qualitiesPerServer[server]) {
                    if (q.link) { defaultLink = q.link; break outer; }
                }
            }
        }

        // Fetch subtitles (same logic as stream.js)
        let subtitles = [];
        try {
            const subRes = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`);
            if (subRes.ok) subtitles = await subRes.json();
        } catch (e) {}

        // Serve player page and inject qualities + selected stream
        const { serveHtml } = await import('./shared/html');
        // Build options for serveHtml: streamUrl is defaultLink, qualities object for settings, pageTitle
        const options = {
            streamUrl: defaultLink || '',
            qualities: qualitiesPerServer,
            pageTitle: title,
            subtitles
        };
        return serveHtml(res, 'index.html', options);
    } catch (e) {
        const status = e && e.status ? e.status : 500;
        const body = e && e.body ? e.body : undefined;
        return res.status(status).json({ error: e.message || 'Unknown error', details: body });
    }
}
