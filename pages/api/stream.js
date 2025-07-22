// Next.js API route for /api/stream

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import cors from 'cors';

// Enable CORS middleware
const corsMiddleware = cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
});

export default async function handler(req, res) {
    corsMiddleware(req, res, async () => {
        const { url, title, tmdb, proxy } = req.query;

        if (proxy) {
            try {
                const response = await fetch(proxy);
                if (!response.ok) {
                    return res.status(response.status).send('Failed to fetch proxy URL');
                }

                const m3u8Content = await response.text();
                const m3u8Lines = m3u8Content.split('\n');
                const rewrittenLines = m3u8Lines.map(line => {
                    if (line.startsWith('http://') || line.startsWith('https://')) {
                        return line;
                    } else if (line.trim() !== '' && !line.startsWith('#')) {
                        const baseUrl = new URL(proxy);
                        return new URL(line, baseUrl).toString();
                    }
                    return line;
                });

                const rewrittenM3u8 = rewrittenLines.join('\n');
                res.setHeader('content-type', 'application/vnd.apple.mpegurl');
                return res.send(rewrittenM3u8);
            } catch (error) {
                return res.status(500).send('Error processing proxy request');
            }
        }

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
    });
}
