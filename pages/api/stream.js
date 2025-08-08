// Next.js API route for /api/stream

import { proxyStream, getProxyHeaders, getVlcHeaders } from './shared/proxy';
import { serveHtml } from './shared/html';
import { corsMiddleware, runMiddleware } from './shared/utils';

export default async function handler(req, res) {
    await runMiddleware(req, res, corsMiddleware);
    const { title, tmdb, vidfast } = req.query;
    const url = req.query.url ? decodeURIComponent(req.query.url) : undefined;

    // If vidfast=1, always proxy with VLC headers (for VidFast/proxy links)
    if (url && (req.query.vidfast === '1' || url.includes('tgtria1dbw.xyz'))) {
        if (!url.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }
        // Use VLC headers for VidFast
        let headers = getVlcHeaders(req);
        try {
            const response = await fetch(url, { headers });
            const contentType = response.headers.get('content-type');
            res.setHeader('Content-Type', contentType || 'application/octet-stream');
            if (contentType && contentType.includes('application/vnd.apple.mpegurl')) {
                // m3u8 playlist: do not set Content-Disposition
                const playlist = await response.text();
                res.send(playlist);
            } else {
                // For segments, set Content-Disposition for .ts only
                const urlParts = req.url.split('/');
                let lastPart = urlParts[urlParts.length - 1].split('?')[0];
                let decodedName = null;
                try {
                    if (/^[A-Za-z0-9+/=]+$/.test(lastPart) && lastPart.length % 4 === 0) {
                        const buf = Buffer.from(lastPart, 'base64');
                        decodedName = buf.toString('utf8');
                    }
                } catch (e) {}
                let segName = null;
                if (decodedName && /([\w-]+)\.(ts|webp|ico|jpg|jpeg|png|gif)$/i.test(decodedName)) {
                    segName = decodedName.replace(/\.(webp|ico|jpg|jpeg|png|gif)$/i, '.ts');
                } else {
                    const segMatch = lastPart.match(/([\w-]+)\.(ts|webp|ico|jpg|jpeg|png|gif)$/i);
                    if (segMatch) {
                        segName = segMatch[1] + '.ts';
                    }
                }
                if (segName) {
                    res.setHeader('Content-Type', 'video/mp2t');
                    res.setHeader('Content-Disposition', `inline; filename=\"${segName}\"`);
                    response.body.pipe(res);
                } else {
                    response.body.pipe(res);
                }
            }
        } catch (err) {
            res.status(500).send('Proxy error: ' + err.message);
        }
        return;
    }

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
