// Next.js API route for /api/stream


import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import urlModule from 'url';
import { pipeline } from 'stream';

export default async function handler(req, res) {
    const { url, title, tmdb, m3u8, segment } = req.query;

    // --- CORS preflight support ---
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Accept, Accept-Language, Referer, Origin, User-Agent, Cookie');
        res.status(204).end();
        return;
    }

    // Proxy for m3u8 playlist
    if (m3u8) {
        try {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Accept, Accept-Language, Referer, Origin, User-Agent, Cookie');
            // Optionally, cache-control for playlist/segments
            // res.setHeader('Cache-Control', 'public, max-age=60');

            // Forward all safe headers from client, override Referer/Origin if needed
            const hopByHop = [
                'host','connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'
            ];
            const headers = {};
            for (const [k, v] of Object.entries(req.headers)) {
                if (!hopByHop.includes(k.toLowerCase())) {
                    headers[k] = v;
                }
            }
            // Force Referer/Origin to upstream if not present
            if (!headers['referer']) headers['referer'] = 'https://hexawave3.xyz/';
            if (!headers['origin']) headers['origin'] = 'https://hexawave3.xyz/';
            // node-fetch does not support gzip by default, so force Accept-Encoding
            headers['accept-encoding'] = 'identity;q=1, *;q=0';

            const playlistRes = await fetch(m3u8, { headers });
            if (!playlistRes.ok) {
                const errText = await playlistRes.text();
                res.status(playlistRes.status).send(errText || 'Failed to fetch playlist');
                return;
            }
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
            res.status(500).send('Error proxying m3u8: ' + (e && e.message ? e.message : 'Unknown error'));
            return;
        }
    }

    // Proxy for segment files
    if (segment) {
        try {
            // Forward all safe headers from client, override Referer/Origin if needed
            const hopByHop = [
                'host','connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'
            ];
            const headers = {};
            for (const [k, v] of Object.entries(req.headers)) {
                if (!hopByHop.includes(k.toLowerCase())) {
                    headers[k] = v;
                }
            }
            if (!headers['referer']) headers['referer'] = 'https://hexawave3.xyz/';
            if (!headers['origin']) headers['origin'] = 'https://hexawave3.xyz/';
            headers['accept-encoding'] = 'identity;q=1, *;q=0';
            const segRes = await fetch(segment, { headers });
            if (!segRes.ok) {
                const errText = await segRes.text();
                res.status(segRes.status).send(errText || 'Failed to fetch segment');
                return;
            }
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
            return res.end('Error proxying segment: ' + (e && e.message ? e.message : 'Unknown error'));
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
