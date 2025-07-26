// Next.js API route for /api/proxy
import fetch from 'node-fetch';

export default async function handler(req, res) {
    const url = req.query.url ? decodeURIComponent(req.query.url) : undefined;
    if (!url || !url.startsWith('http')) {
        return res.status(400).send('Invalid URL');
    }
    try {
        const response = await fetch(url);
        const contentType = response.headers.get('content-type');
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
        if (response.body) {
            response.body.pipe(res);
        } else {
            const buffer = await response.buffer();
            res.send(buffer);
        }
    } catch (e) {
        res.status(500).send('Proxy failed');
    }
}
