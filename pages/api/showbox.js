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

function constructShowboxLink(title, runtime, release_date, api) {
    const year = release_date ? String(release_date).split('-')[0] : '';
    const safeTitle = encodeURIComponent(title || '');
    const apiParam = api ? `&api=${encodeURIComponent(api)}` : '';
    return `https://showbox-five.vercel.app/api/scrape?title=${safeTitle}&year=${year}&rt=${runtime || 0}&type=1${apiParam}`;
}

async function fetchShowboxJson(url, timeout = 30000, interval = 2000, requireLink = true) {
    // Helper to detect if parsed JSON contains at least one stream link
    const hasAnyLink = (obj) => {
        if (!obj || typeof obj !== 'object') return false;
        for (const k of Object.keys(obj)) {
            const arr = Array.isArray(obj[k]) ? obj[k] : [];
            for (const item of arr) {
                if (item && item.link) return true;
            }
        }
        return false;
    };

    // Instead of aggressively polling every few seconds, perform a single
    // long-lived fetch and wait up to `timeout` ms for the scraper to return
    // an OK (200) response. This reduces hammering the scraper while keeping
    // the original timeout semantics.
    let lastStatus = null;
    let lastText = null;
    try {
        const controller = new AbortController();
        // Use the provided timeout as the request-level timeout so the fetch
        // will abort if the scraper doesn't respond within that window.
        const t = setTimeout(() => controller.abort(), timeout);
        let res;
        try {
            res = await fetch(url, { signal: controller.signal });
            // capture last status/text for diagnostics (non-fatal)
            try {
                lastStatus = res && res.status;
                lastText = await (res && res.clone && res.clone().text ? res.clone().text() : Promise.resolve(null));
            } catch (e) {
                // ignore clone/read errors
            }
        } finally {
            clearTimeout(t);
        }

        // Return parsed JSON only if we got an OK response and the JSON meets
        // the caller's requirements (i.e., contains links when required).
        if (res && res.ok) {
            try {
                const json = await res.json();
                if (!requireLink || hasAnyLink(json)) return json;
            } catch (e) {
                // not JSON or parse error — fallthrough to return null
            }
        } else {
            // non-200 response — log diagnostics and return null so callers
            // can handle this as a failure (matches prior behavior on timeout)
            try {
                console.error('Showbox wait finished with non-200', { url, status: lastStatus, lastText: lastText && lastText.slice ? lastText.slice(0, 200) : lastText });
            } catch (e) {}
            return null;
        }
    } catch (e) {
        // network error or abort
        try { console.error('Showbox fetch error', e && e.message ? e.message : e); } catch (err) {}
        return null;
    }
    // log diagnostic context for why we timed out trying to get JSON
    try {
        console.error('Showbox polling timed out', { url, timeout, lastStatus, lastText: lastText && lastText.slice ? lastText.slice(0, 200) : lastText });
    } catch (e) {}
    return null;
}

export default async function handler(req, res) {
    const tmdb = req.query.tmdb || req.query.id || req.query.movie || '';
    if (!tmdb) return res.status(400).json({ error: 'Missing tmdb query parameter' });

    try {
        const movie = await getMovieData(String(tmdb));
        const title = movie.title || movie.original_title || '';
        const runtime = typeof movie.runtime === 'number' ? movie.runtime : 0;
        const release_date = movie.release_date || '';

        const api = req.query.api || '';
        const showbox_link = constructShowboxLink(title, runtime, release_date, api);

        // Poll the Showbox scraper until it returns JSON that contains at least one stream link.
        // Match original behavior: poll every 2s up to ~30s.
        console.log('Polling Showbox scraper URL', showbox_link, 'tmdb', tmdb);
        const json = await fetchShowboxJson(showbox_link, 30000, 2000, false);

        // If we didn't get JSON, return 502
        if (!json) {
            return res.status(502).json({ error: 'Failed to retrieve showbox JSON' });
        }

        // Normalize qualities into an ordered list per server
        // json is expected to be an object with server keys each mapping to an array of {quality, link}
        // Normalize qualities into an ordered list per server, but only include items
        // that actually have a link to avoid serving an empty streamUrl.
        const qualitiesPerServer = {};
        Object.keys(json).forEach(server => {
            const arr = Array.isArray(json[server]) ? json[server] : [];
            qualitiesPerServer[server] = arr
                .filter(item => item && item.link)
                .map(item => ({ quality: item.quality, link: item.link }));
            if (qualitiesPerServer[server].length === 0) delete qualitiesPerServer[server];
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
    // surface errors to logs for easier debugging
    try { console.error('showbox handler error', e && e.message ? e.message : e, e && e.body ? { body: e.body } : undefined); } catch (err) {}
        const status = e && e.status ? e.status : 500;
        const body = e && e.body ? e.body : undefined;
        return res.status(status).json({ error: e.message || 'Unknown error', details: body });
    }
}
