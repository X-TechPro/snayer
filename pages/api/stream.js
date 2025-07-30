// Next.js API route for /api/stream

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

export default async function handler(req, res) {
    const { title, tmdb } = req.query;
    const url = req.query.url ? decodeURIComponent(req.query.url) : undefined;

    // If mbox=1 param is present, serve index.html with window.source set to a proxy endpoint
    if (url && req.query.mbox === '1') {
        if (!url.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }
        // Serve index.html with window.source set to /api/stream?file=...
        const htmlPath = path.join(process.cwd(), 'public', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        const proxySrc = `/api/stream?file=${encodeURIComponent(url)}`;
        html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(proxySrc)};window.__MBOX_HEADERS__ = true;</script>`);
        if (title) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(title)};</script>`);
        }
        if (tmdb) {
            let subtitles = [];
            try {
                const subRes = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`);
                if (subRes.ok) {
                    subtitles = await subRes.json();
                }
            } catch (e) {}
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__SUBTITLES__ = ${JSON.stringify(subtitles)};</script>`);
        }
        res.setHeader('content-type', 'text/html');
        res.send(html);
        return;
    }

    // If file param is present, proxy the video file with required headers (for player)
    if (req.query.file) {
        const fileUrl = decodeURIComponent(req.query.file);
        if (!fileUrl.startsWith('http')) {
            return res.status(400).send('Invalid file URL');
        }
        const headers = {
            'Origin': 'https://moviebox.ng',
            'Referer': 'https://moviebox.ng',
            ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
        };
        try {
            const response = await fetch(fileUrl, { headers });
            res.status(response.status);
            for (const [key, value] of response.headers.entries()) {
                if (key.toLowerCase() === 'content-disposition') continue;
                res.setHeader(key, value);
            }
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Disposition', 'inline');
            // Use stream.pipeline for better performance
            const { pipeline } = await import('stream');
            pipeline(response.body, res, (err) => {
                if (err) {
                    res.end();
                }
            });
        } catch (err) {
            res.status(500).send('Proxy error: ' + err.message);
        }
        return;
    }

    // Otherwise, serve index.html as before
    const htmlPath = path.join(process.cwd(), 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    // Fetch subtitles if tmdb param is present
    let subtitles = [];
    if (tmdb) {
        try {
            const subRes = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`);
            if (subRes.ok) {
                subtitles = await subRes.json();
            }
        } catch (e) {
            // ignore subtitle errors
        }
    }

    if (url) {
        if (!url.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }
        html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(url)};</script>`);
        if (title) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(title)};</script>`);
        }
        if (tmdb) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__SUBTITLES__ = ${JSON.stringify(subtitles)};</script>`);
        }
    }

    res.setHeader('content-type', 'text/html');
    res.send(html);
}
