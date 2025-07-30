// Next.js API route for /api/stream

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

export default async function handler(req, res) {
    const { title, tmdb } = req.query;
    // Decode the url param to preserve all query string parts (e.g. &s=...)
    let url = req.query.url ? decodeURIComponent(req.query.url) : undefined;

    // If the link is a vidsrc.co proxy, extract the 'u' param and inject into index.html for playback
    if (url && url.includes('proxy.vidsrc.co')) {
        // Handle double-encoded URLs
        let parsedUrl = url;
        try {
            // If url is still encoded, decode again
            while (parsedUrl.includes('%3A') || parsedUrl.includes('%2F')) {
                parsedUrl = decodeURIComponent(parsedUrl);
            }
        } catch (e) {
            // ignore decode errors
        }
        // Extract 'u' param from proxy.vidsrc.co
        let uMatch = parsedUrl.match(/[?&]u=([^&]+)/);
        let baseUrl = null;
        if (uMatch && uMatch[1]) {
            baseUrl = decodeURIComponent(uMatch[1]);
            // Remove any trailing params (&o=... etc)
            const ampIdx = baseUrl.indexOf('&');
            if (ampIdx !== -1) {
                baseUrl = baseUrl.substring(0, ampIdx);
            }
        }
        if (baseUrl && baseUrl.startsWith('http')) {
            // Inject the extracted video URL into index.html for playback
            const htmlPath = path.join(process.cwd(), 'public', 'index.html');
            let html = fs.readFileSync(htmlPath, 'utf8');
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(baseUrl)};</script>`);
            if (title) {
                html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(title)};</script>`);
            }
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
                html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__SUBTITLES__ = ${JSON.stringify(subtitles)};</script>`);
            }
            res.setHeader('content-type', 'text/html');
            res.send(html);
            return;
        } else {
            return res.status(400).send('Invalid proxy.vidsrc.co URL');
        }
    }

    // ...existing code...
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
        // Inject the proxied video source into the HTML for the player using window.source
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
