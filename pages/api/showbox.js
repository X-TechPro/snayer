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

    try {
        const movie = await getMovieData(String(tmdb));
        const title = movie.title || movie.original_title || '';
        const runtime = typeof movie.runtime === 'number' ? movie.runtime : 0;
        const release_date = movie.release_date || '';

        const showbox_link = constructShowboxLink(title, runtime, release_date);

        const json = await fetchShowboxJson(showbox_link, 20000, 3000);

        return res.status(200).json({
            tmdb_id: String(tmdb),
            title,
            runtime,
            release_date,
            showbox_link,
            json_received: json !== null,
            json
        });
    } catch (e) {
        const status = e && e.status ? e.status : 500;
        const body = e && e.body ? e.body : undefined;
        return res.status(status).json({ error: e.message || 'Unknown error', details: body });
    }
}
