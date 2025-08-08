// Next.js API route for /api/stream


import { proxyStream, getProxyHeaders } from './shared/proxy';
import { serveHtml } from './shared/html';
import { corsMiddleware, runMiddleware } from './shared/utils';


export default async function handler(req, res) {
    await runMiddleware(req, res, corsMiddleware);
    const { title, tmdb } = req.query;
    const url = req.query.url ? decodeURIComponent(req.query.url) : undefined;

    // If mbox=1 and raw=1, proxy the video file with required headers (for player fetch)
    if (url && req.query.mbox === '1' && req.query.raw === '1') {
        if (!url.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }
        // Use madplay-specific headers if url is from madplay
        let headers = getProxyHeaders('mbox', req);
        if (url.includes('madplay.site')) {
            headers = {
                ...headers,
                origin: 'https://uembed.site',
                referer: 'https://uembed.site',
            };
        }
        try {
            await proxyStream(req, res, url, headers);
        } catch (err) {
            res.status(500).send('Proxy error: ' + err.message);
        }
        return;
    }

    // If mbox=1, serve index.html and inject window.source as the proxy endpoint
    if (url && req.query.mbox === '1') {
        let subtitles = [];
        if (tmdb) {
            try {
                const subRes = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`);
                if (subRes.ok) {
                    subtitles = await subRes.json();
                }
            } catch (e) {}
        }
        const proxyUrl = `/api/stream?url=${encodeURIComponent(url)}&mbox=1&raw=1`;
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
