// Next.js API route for /api/stream

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

export default async function handler(req, res) {
    console.log("API Called with query:", req.query); // new log added
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
        console.log("Received URL:", url); // debug log added
        if (!url.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }
        
        if (url.endsWith('.m3u8')) {
            // Fetch m3u8 file content and rewrite segments if necessary
            const m3u8Res = await fetch(url);
            if (!m3u8Res.ok) {
                return res.status(400).send('Failed to fetch m3u8');
            }
            let m3u8Content = await m3u8Res.text();
            const lines = m3u8Content.split('\n');
            const firstSegment = lines.find(line => line.trim() !== '' && !line.startsWith('#'));
            if (firstSegment && !firstSegment.startsWith('http')) {
                const parsedUrl = new URL(url);
                const baseUrl = parsedUrl.origin + parsedUrl.pathname.substring(0, parsedUrl.pathname.lastIndexOf('/') + 1);
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.trim() !== '' && !line.startsWith('#')) {
                        lines[i] = new URL(line, baseUrl).toString();
                    }
                }
                m3u8Content = lines.join('\n');
            }
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', 
                `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(m3u8Content)};</script>`);
        } else {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', 
                `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(url)};</script>`);
        }
        if (title) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', 
                `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(title)};</script>`);
        }
        // Inject subtitles as a JS variable
        if (tmdb) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__SUBTITLES__ = ${JSON.stringify(subtitles)};</script>`);
        }
    }

    res.setHeader('content-type', 'text/html');
    res.send(html);
}
