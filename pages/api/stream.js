// Next.js API route for /api/stream


import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import urlModule from 'url';
import { pipeline } from 'stream';

export default async function handler(req, res) {
    const { url, title, tmdb, m3u8, segment } = req.query;

    // Proxy for m3u8 playlist
    if (m3u8) {
        try {
            // --- CORS headers for all responses ---
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            // Optionally, cache-control for playlist/segments
            // res.setHeader('Cache-Control', 'public, max-age=60');

            // Browser-like headers
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
                'Referer': 'https://hexawave3.xyz/',
                'Origin': 'https://hexawave3.xyz/'
                // 'Accept-Encoding': 'identity;q=1, *;q=0', // node-fetch does not support gzip by default
            };
            // m3u8 is the playlist URL
            const playlistRes = await fetch(m3u8, { headers });
            if (!playlistRes.ok) return res.status(502).send('Failed to fetch playlist');
            let playlistText = await playlistRes.text();

            // Get base URL for relative segments
            const parsed = urlModule.parse(m3u8);
            const baseUrl = `${parsed.protocol}//${parsed.host}`;
            const basePath = parsed.pathname ? parsed.pathname.substring(0, parsed.pathname.lastIndexOf('/') + 1) : '/';
            const fullBase = baseUrl + basePath;

            // --- Robust playlist rewriting ---
            const lines = playlistText.split(/\r?\n/);
            const rewritten = lines.map((line) => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return line;
                if (/^https?:\/\//i.test(trimmed)) {
                    // Absolute URL, stream directly
                    return trimmed;
                } else {
                    // Relative path, rewrite to proxy
                    const proxied = `/api/stream?segment=${encodeURIComponent(urlModule.resolve(fullBase, trimmed))}`;
                    return proxied;
                }
            });
            res.setHeader('content-type', 'application/vnd.apple.mpegurl');
            // res.setHeader('Cache-Control', 'public, max-age=60'); // Optional
            return res.send(rewritten.join('\n'));
        } catch (e) {
            return res.status(500).send('Error proxying m3u8');
        }
    }

    // Proxy for segment files
    if (segment) {
        try {
            // Browser-like headers, forward Range if present
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
                'Referer': 'https://hexawave3.xyz/',
                'Origin': 'https://hexawave3.xyz/'
            };
            if (req.headers['range']) {
                headers['Range'] = req.headers['range'];
            }
            const segRes = await fetch(segment, { headers });
            if (!segRes.ok) return res.status(502).send('Failed to fetch segment');
            // Forward headers for video streaming
            res.setHeader('content-type', segRes.headers.get('content-type') || 'application/octet-stream');
            // Forward range/partial content headers if present
            if (segRes.headers.get('content-range')) {
                res.setHeader('content-range', segRes.headers.get('content-range'));
                res.statusCode = 206;
            }
            // res.setHeader('Cache-Control', 'public, max-age=60'); // Optional
            // Robust stream piping with error handling
            pipeline(segRes.body, res, (err) => {
                if (err) {
                    if (!res.headersSent) res.writeHead(500);
                    res.end('Segment stream error');
                }
            });
            return;
        } catch (e) {
            if (!res.headersSent) res.status(500);
            return res.end('Error proxying segment');
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
