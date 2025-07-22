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

        // If the url is an m3u8 playlist, proxy and rewrite it
        if (url.match(/\.m3u8($|\?)/)) {
            try {
                // Fetch the m3u8 playlist through the proxy
                const m3u8Res = await fetch(url, { headers: req.headers });
                if (!m3u8Res.ok) {
                    return res.status(502).send('Failed to fetch playlist');
                }
                let m3u8Text = await m3u8Res.text();

                // Parse and rewrite the playlist
                const baseUrl = url.split('?')[0];
                const baseDir = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
                const lines = m3u8Text.split(/\r?\n/);
                let rewritten = [];
                for (let line of lines) {
                    if (line.trim() === '' || line.startsWith('#')) {
                        rewritten.push(line);
                        continue;
                    }
                    if (line.startsWith('http://') || line.startsWith('https://')) {
                        // If any segment is absolute, stop rewriting and return the playlist as-is
                        res.setHeader('content-type', 'application/vnd.apple.mpegurl');
                        return res.send(m3u8Text);
                    }
                    // Otherwise, resolve relative to the m3u8 URL
                    let resolved = baseDir + line;
                    rewritten.push(resolved);
                }
                res.setHeader('content-type', 'application/vnd.apple.mpegurl');
                return res.send(rewritten.join('\n'));
            } catch (err) {
                return res.status(500).send('Error proxying playlist');
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
