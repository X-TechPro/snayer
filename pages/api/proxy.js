// Next.js API route for /api/proxy
import fetch from 'node-fetch';
import { corsMiddleware, runMiddleware } from './shared/utils';

export default async function handler(req, res) {
    await runMiddleware(req, res, corsMiddleware);
    const url = req.query.url ? decodeURIComponent(req.query.url) : undefined;
    if (!url || !url.startsWith('http')) {
        return res.status(400).send('Invalid URL');
    }
    try {
        // Forward Range header if present
        const headers = {};
        if (req.headers['range']) {
            headers['range'] = req.headers['range'];
        }
        const response = await fetch(url, { headers });
        const contentType = response.headers.get('content-type');
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        // Forward Content-Range and status for partial content
        if (response.status === 206) {
            res.status(206);
            const contentRange = response.headers.get('content-range');
            if (contentRange) {
                res.setHeader('Content-Range', contentRange);
            }
        }
        // If m3u8 playlist, rewrite segment URLs to absolute and force download if browser requests
        if (contentType && contentType.includes('application/vnd.apple.mpegurl')) {
            const playlist = await response.text();
            // Get base URL (remove query params and filename)
            const baseUrl = url.split('?')[0].replace(/\/[^\/]*$/, '/');
            const rewritten = playlist.split('\n').map(line => {
                if (
                    line &&
                    !line.startsWith('#') &&
                    !line.startsWith('http') &&
                    !line.startsWith('https://') &&
                    !line.startsWith('/')
                ) {
                    return baseUrl + line;
                }
                return line;
            }).join('\n');
            // If browser requests (Accept header includes text/html), force download
            if (req.headers['accept'] && req.headers['accept'].includes('text/html')) {
                res.setHeader('Content-Disposition', 'attachment; filename="playlist.m3u8"');
            }
            res.send(rewritten);
        } else if (response.body) {
            response.body.pipe(res);
        } else {
            const buffer = await response.buffer();
            res.send(buffer);
        }
    } catch (e) {
        res.status(500).send('Proxy failed');
    }
}
