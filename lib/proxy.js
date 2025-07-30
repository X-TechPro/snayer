// Proxy utility for streaming and m3u8 rewriting
const fetch = require('node-fetch');
const { Readable } = require('stream');

async function proxyStream({ req, res, url, headers = {}, rewriteM3U8 = false }) {
    if (!url || !url.startsWith('http')) return res.status(400).send('Invalid URL');
    try {
        const response = await fetch(url, { headers });
        const contentType = response.headers.get('content-type');
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        if (response.status === 206) {
            res.status(206);
            const contentRange = response.headers.get('content-range');
            if (contentRange) res.setHeader('Content-Range', contentRange);
        }
        if (rewriteM3U8 && contentType && contentType.includes('application/vnd.apple.mpegurl')) {
            const playlist = await response.text();
            const baseUrl = url.split('?')[0].replace(/\/[^\/]*$/, '/');
            const rewritten = playlist.split('\n').map(line => {
                if (line && !line.startsWith('#') && !line.startsWith('http') && !line.startsWith('https://') && !line.startsWith('/')) {
                    return baseUrl + line;
                }
                return line;
            }).join('\n');
            if (req.headers['accept'] && req.headers['accept'].includes('text/html')) {
                res.setHeader('Content-Disposition', 'attachment; filename="playlist.m3u8"');
            }
            res.send(rewritten);
        } else if (response.body) {
            Readable.from(response.body).pipe(res);
        } else {
            const buffer = await response.buffer();
            res.send(buffer);
        }
    } catch (e) {
        res.status(500).send('Proxy failed');
    }
}

module.exports = { proxyStream };
