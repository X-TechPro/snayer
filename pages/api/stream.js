// Next.js API route for /api/stream

import { proxyStream, getProxyHeaders } from './shared/proxy';
import { serveHtml } from './shared/html';
import { corsMiddleware, runMiddleware } from './shared/utils';

export default async function handler(req, res) {
    await runMiddleware(req, res, corsMiddleware);
    const { title, tmdb } = req.query;
    const url = req.query.url ? decodeURIComponent(req.query.url) : undefined;

    // No VidFast/VidRock handling present

    // If prx=1 and raw=1, proxy the video file with required headers (for player fetch)
    if (url && req.query.prx === '1' && req.query.raw === '1') {
        // If the incoming `url` wasn't URL-encoded by the caller, some of the
        // target URL's query params may have been promoted to top-level
        // parameters on our endpoint (e.g. KEY2=... KEY3=...). Reconstruct the
        // full target URL by appending any non-reserved query params back to it.
        let fullUrl = url;
        const reserved = new Set(['title', 'tmdb', 'prx', 'raw', 'type', 's', 'e', 'season', 'episode', 'progress', 'api', 'url']);
        for (const [k, v] of Object.entries(req.query)) {
            if (k === 'url' || reserved.has(k)) continue;
            // skip empty keys
            if (!k) continue;
            const values = Array.isArray(v) ? v : [v];
            for (const val of values) {
                // Append using proper separators; values are added URL-encoded.
                fullUrl += (fullUrl.includes('?') ? '&' : '?') + encodeURIComponent(k) + '=' + encodeURIComponent(val);
            }
        }

        if (!fullUrl.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }

        // Build proxy headers (site-aware) and mark useProxy=true so Origin/Referer
        // are derived from the target base URL
        const headers = getProxyHeaders(req, fullUrl, true);
        try {
            await proxyStream(req, res, fullUrl, headers);
        } catch (err) {
            res.status(500).send('Proxy error: ' + err.message);
        }
        return;
    }

    // If prx=1, serve index.html and inject window.source as the proxy endpoint
    if (url && req.query.prx === '1') {
        let subtitles = [];
        if (tmdb) {
            try {
                const subRes = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`);
                if (subRes.ok) {
                    subtitles = await subRes.json();
                }
            } catch (e) {}
        }
    const proxyUrl = `/api/stream?url=${encodeURIComponent(url)}&prx=1&raw=1`;
        serveHtml(res, 'index.html', {
            streamUrl: proxyUrl,
            pageTitle: title,
            subtitles,
        });
        return;
    }

    // Otherwise, serve index.html as before
    let subtitles = [];
    if (tmdb) {
        try {
            const subRes = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`);
            if (subRes.ok) {
                subtitles = await subRes.json();
            }
        } catch (e) {}
    }

    if (url) {
        if (!url.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }
        serveHtml(res, 'index.html', {
            streamUrl: url,
            pageTitle: title,
            subtitles,
        });
        return;
    }

    serveHtml(res, 'index.html', { subtitles });
}
