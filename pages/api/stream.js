// Next.js API route for /api/stream

import { proxyStream, getProxyHeaders } from './shared/proxy';
import { serveHtml } from './shared/html';
import { corsMiddleware, runMiddleware } from './shared/utils';

export default async function handler(req, res) {
    await runMiddleware(req, res, corsMiddleware);
    const { title, tmdb } = req.query;
    // Extract full target URL even when the caller didn't encode it.
    // Example problematic request: /api/stream?url=https://example.com/file.mp4?A=1&B=2&prx=1
    // In that case Next/Node will parse B=2 as a separate query param. We reconstruct
    // the original URL by grabbing the raw req.url and slicing out any other known params.
    function extractFullUrl(req) {
        if (!req.url) return req.query.url;
        const raw = req.url;
        const idx = raw.indexOf('url=');
        if (idx === -1) return req.query.url;
        let rest = raw.slice(idx + 4); // after 'url='
        // Remove leading path part if present (shouldn't be), keep only query tail
        // Only cut at known top-level server query keys (so we don't trim params that belong
        // to the embedded URL). Example top-level keys: prx, raw, title, tmdb, type, s, e, progress, api
        const topLevelKeys = ['prx', 'raw', 'title', 'tmdb', 'type', 's', 'e', 'progress', 'api'];
        const regex = new RegExp("&(?:" + topLevelKeys.join('|') + ")=", 'i');
        const m = regex.exec(rest);
        if (m && typeof m.index === 'number') {
            rest = rest.slice(0, m.index);
        }
        try {
            // Try to decode if encoded, otherwise return as-is
            return decodeURIComponent(rest);
        } catch (e) {
            return rest;
        }
    }

    const url = req.query.url ? extractFullUrl(req) : undefined;

    // No VidFast/VidRock handling present

    // If prx=1 and raw=1, proxy the video file with required headers (for player fetch)
    if (url && req.query.prx === '1' && req.query.raw === '1') {
        if (!url.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }
    // Build proxy headers (site-aware)
    const headers = getProxyHeaders(req, url, true);
        try {
            await proxyStream(req, res, url, headers);
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
