// Next.js API route for /api/stream

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

export default async function handler(req, res) {
    const { url, title, tmdb } = req.query;

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

        // If the url is an m3u8 playlist, fetch and rewrite it (allow query params)
        if (url.includes('.m3u8')) {
            try {
                // Fetch the m3u8 through the proxy (this API itself)
                const m3u8Res = await fetch(url, { headers: req.headers });
                if (!m3u8Res.ok) {
                    return res.status(502).send('Failed to fetch m3u8');
                }
                let m3u8Text = await m3u8Res.text();
                // Find the index after .m3u8 for base URL
                const m3u8Idx = url.indexOf('.m3u8');
                let baseUrl;
                if (m3u8Idx !== -1) {
                    // baseUrl is up to and including the last slash before .m3u8
                    const lastSlash = url.lastIndexOf('/', m3u8Idx);
                    baseUrl = url.substring(0, lastSlash + 1);
                } else {
                    baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
                }
                const lines = m3u8Text.split(/\r?\n/);
                let rewritten = [];
                for (let line of lines) {
                    // If the line is a segment (not a comment or tag)
                    if (line && !line.startsWith('#')) {
                        if (line.startsWith('http://') || line.startsWith('https://')) {
                            // If any segment is absolute, stop rewriting and return original
                            res.setHeader('content-type', 'application/vnd.apple.mpegurl');
                            return res.send(m3u8Text);
                        } else {
                            // Resolve relative segment URL using correct base
                            const resolved = new URL(line, baseUrl).toString();
                            rewritten.push(resolved);
                            continue;
                        }
                    }
                    rewritten.push(line);
                }
                const outM3u8 = rewritten.join('\n');
                res.setHeader('content-type', 'application/vnd.apple.mpegurl');
                return res.send(outM3u8);
            } catch (e) {
                return res.status(500).send('Error processing m3u8');
            }
        }

        // Otherwise, inject the video source and title into the HTML for the player using window.source
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
