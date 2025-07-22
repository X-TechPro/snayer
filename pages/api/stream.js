// Next.js API route for /api/stream


import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import urlModule from 'url';

export default async function handler(req, res) {
    const { url, title, tmdb, m3u8, segment } = req.query;

    // Proxy for m3u8 playlist
    if (m3u8) {
        try {
            // m3u8 is the playlist URL
            const playlistRes = await fetch(m3u8);
            if (!playlistRes.ok) return res.status(502).send('Failed to fetch playlist');
            let playlist = await playlistRes.text();

            // Get base URL for relative segments
            const parsed = urlModule.parse(m3u8);
            const baseUrl = `${parsed.protocol}//${parsed.host}`;
            const basePath = parsed.pathname ? parsed.pathname.substring(0, parsed.pathname.lastIndexOf('/') + 1) : '/';
            const fullBase = baseUrl + basePath;

            // Rewrite segment URIs
            playlist = playlist.replace(/^(?!#)([^\r\n]+)$/gm, (line) => {
                line = line.trim();
                if (!line || line.startsWith('#')) return line;
                if (/^https?:\/\//i.test(line)) {
                    // Absolute URL, stream directly
                    return line;
                } else {
                    // Relative path, rewrite to proxy
                    // Option 1: Proxy through API (recommended for CORS)
                    const proxied = `/api/stream?segment=${encodeURIComponent(urlModule.resolve(fullBase, line))}`;
                    return proxied;
                }
            });
            res.setHeader('content-type', 'application/vnd.apple.mpegurl');
            return res.send(playlist);
        } catch (e) {
            return res.status(500).send('Error proxying m3u8');
        }
    }

    // Proxy for segment files
    if (segment) {
        try {
            const segRes = await fetch(segment);
            if (!segRes.ok) return res.status(502).send('Failed to fetch segment');
            // Forward headers for video streaming
            res.setHeader('content-type', segRes.headers.get('content-type') || 'application/octet-stream');
            segRes.body.pipe(res);
            return;
        } catch (e) {
            return res.status(500).send('Error proxying segment');
        }
    }

    // ...existing code for HTML player...
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
        // Inject the video source and title into the HTML for the player using window.source
        html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(url)};</script>`);
        if (title) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(title)};</script>`);
        }
        // Inject subtitles as a JS variable
        if (tmdb) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__SUBTITLES__ = ${JSON.stringify(subtitles)};</script>`);
        }
    }

    res.setHeader('content-type', 'text/html');
    res.send(html);
}
