// Next.js API route for /api/stream

import { proxyStream, getProxyHeaders, getVlcHeaders } from './shared/proxy';
import { serveHtml } from './shared/html';
import { corsMiddleware, runMiddleware } from './shared/utils';

export default async function handler(req, res) {
    await runMiddleware(req, res, corsMiddleware);
    const { title, tmdb, vidfast } = req.query;
    const url = req.query.url ? decodeURIComponent(req.query.url) : undefined;

    // If vidfast=1, or the URL looks like a VidFast worker, either serve the player
    // (which will point to a proxied raw endpoint) or act as the raw proxy when requested.
    if (url && (req.query.vidfast === '1' || url.includes('tgtria1dbw.xyz') || url.includes('fastinternetz'))) {
        if (!url.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }

        // If this is the raw fetch (used by the player to retrieve playlist/segments), proxy it.
        if (req.query.raw === '1') {
            // Use VLC headers for VidFast
            let headers = getVlcHeaders(req);
            try {
                const response = await fetch(url, { headers });
                const contentTypeRaw = response.headers.get('content-type') || '';
                const contentType = String(contentTypeRaw).toLowerCase();
                res.setHeader('Content-Type', contentTypeRaw || 'application/octet-stream');

                // treat any m3u8 / mpegurl variant as a playlist
                if (contentType.includes('mpegurl') || contentType.includes('application/x-mpegurl') || contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('vnd.apple.mpegurl')) {
                    const playlist = await response.text();
                    return res.send(playlist);
                }

                // For segments: compute a friendly filename when possible, then stream.
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
                }

                // response.body might be a Web ReadableStream (no .pipe) in some Node runtimes.
                if (response.body && typeof response.body.pipe === 'function') {
                    return response.body.pipe(res);
                }

                // Fallback: buffer the body and send (works for both playlists and segments but uses memory)
                const ab = await response.arrayBuffer();
                const buf = Buffer.from(ab);
                return res.end(buf);
            } catch (err) {
                return res.status(500).send('Proxy error: ' + err.message);
            }
        }

        // Otherwise, serve the HTML player and inject a proxied raw endpoint flagged as m3u8
        let subtitles = [];
        if (tmdb) {
            try {
                const subRes = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`);
                if (subRes.ok) {
                    subtitles = await subRes.json();
                }
            } catch (e) {}
        }
        const proxyUrl = `/api/stream?url=${encodeURIComponent(url)}&vidfast=1&raw=1&m3u8=1`;
        serveHtml(res, 'index.html', {
            streamUrl: proxyUrl,
            pageTitle: title,
            subtitles,
        });
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
