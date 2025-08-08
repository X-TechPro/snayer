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
            // Always serve m3u8 as inline for playback (never force download)
            res.send(rewritten);
        } else if (response.body) {
            // --- SEGMENT REWRITE LOGIC ---
            // If the requested file is a segment (ends with .ts or .webp/.ico/.jpg etc), always serve as TS
            // Also handle base64-encoded segment names (e.g. /c2VnLTIzMjktdjEtYTEud2VicA==)
            const urlParts = req.url.split('/');
            let lastPart = urlParts[urlParts.length - 1].split('?')[0];
            let decodedName = null;
            try {
                // Try to decode base64 if it looks like base64
                if (/^[A-Za-z0-9+/=]+$/.test(lastPart) && lastPart.length % 4 === 0) {
                    const buf = Buffer.from(lastPart, 'base64');
                    decodedName = buf.toString('utf8');
                }
            } catch (e) {}
            // If decodedName is a segment (seg-xxx.ts or seg-xxx.webp etc), use that for filename
            let segName = null;
            if (decodedName && /([\w-]+)\.(ts|webp|ico|jpg|jpeg|png|gif)$/i.test(decodedName)) {
                segName = decodedName.replace(/\.(webp|ico|jpg|jpeg|png|gif)$/i, '.ts');
            } else {
                // fallback: try to match extension in original url
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
        } else {
            const buffer = await response.buffer();
            res.send(buffer);
        }
    } catch (e) {
        res.status(500).send('Proxy failed');
    }
}
