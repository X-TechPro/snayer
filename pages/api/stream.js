// Next.js API route for /api/stream

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

export default async function handler(req, res) {
    const { title, tmdb } = req.query;
    // Decode the url param to preserve all query string parts (e.g. &s=...)
    let url = req.query.url ? decodeURIComponent(req.query.url) : undefined;

    // If the link is a vidsrc.co proxy, extract the 'u' param
    if (url && url.includes('proxy.vidsrc.co')) {
        // Handle double-encoded URLs
        let parsedUrl = url;
        try {
            while (parsedUrl.includes('%3A') || parsedUrl.includes('%2F')) {
                parsedUrl = decodeURIComponent(parsedUrl);
            }
        } catch (e) {}
        // Extract 'u' param from proxy.vidsrc.co
        let uMatch = parsedUrl.match(/[?&]u=([^&]+)/);
        let baseUrl = null;
        if (uMatch && uMatch[1]) {
            baseUrl = decodeURIComponent(uMatch[1]);
            const ampIdx = baseUrl.indexOf('&');
            if (ampIdx !== -1) {
                baseUrl = baseUrl.substring(0, ampIdx);
            }
        }
        if (baseUrl && baseUrl.startsWith('http')) {
            // If the request is for the video file (Range header or Accept not text/html), stream with custom headers
            const acceptHeader = req.headers['accept'] || '';
            if (req.headers['range'] || !acceptHeader.includes('text/html')) {
                try {
                    const headers = {
                        'Referer': 'https://moviebox.ng',
                        'Origin': 'https://moviebox.ng',
                    };
                    if (req.headers['range']) {
                        headers['Range'] = req.headers['range'];
                    }
                    const response = await fetch(baseUrl, { headers });
                    res.status(response.status);
                    for (const [key, value] of response.headers.entries()) {
                        res.setHeader(key, value);
                    }
                    response.body.pipe(res);
                } catch (err) {
                    res.status(500).send('Proxy error: ' + err.message);
                }
                return;
            } else {
                // Otherwise, inject the video URL into index.html for playback
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
                    } catch (e) {}
                    html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__SUBTITLES__ = ${JSON.stringify(subtitles)};</script>`);
                }
                res.setHeader('content-type', 'text/html');
                res.send(html);
                return;
            }
        } else {
            return res.status(400).send('Invalid proxy.vidsrc.co URL');
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
