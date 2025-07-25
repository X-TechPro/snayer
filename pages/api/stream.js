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

        // If the URL is an m3u8 playlist, handle segment rewriting
        if (url.endsWith('.m3u8')) {
            try {
                // Always use the full URL (with all query params)
                const m3u8Res = await fetch(url, { headers: req.headers });
                if (!m3u8Res.ok) {
                    return res.status(502).send('Failed to fetch m3u8');
                }
                let m3u8Text = await m3u8Res.text();

                // Find first segment line (not comment, not empty)
                const lines = m3u8Text.split('\n');
                const firstSegment = lines.find(line => line && !line.startsWith('#'));
                if (firstSegment && (/^https?:\/\//.test(firstSegment))) {
                    // First segment is absolute, return playlist as-is
                    html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(url)};</script>`);
                } else {
                    // Need to resolve segments relative to m3u8 URL
                    const m3u8UrlObj = new URL(url);
                    const baseUrl = m3u8UrlObj.origin + m3u8UrlObj.pathname.replace(/[^\/]+$/, '');

                    const rewritten = lines.map(line => {
                        if (!line || line.startsWith('#')) return line;
                        // If already absolute, leave as-is
                        if (/^https?:\/\//.test(line)) return line;
                        // Otherwise, resolve relative to m3u8 URL
                        return baseUrl + line;
                    }).join('\n');

                    // Serve the rewritten playlist as a data URL
                    // (or you could serve via another endpoint, but here we inline)
                    const blobUrl = `data:application/vnd.apple.mpegurl;base64,${Buffer.from(rewritten).toString('base64')}`;
                    html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(blobUrl)};</script>`);
                }
            } catch (err) {
                return res.status(502).send('Error processing m3u8');
            }
        } else {
            // Non-m3u8: just inject the video source as before
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(url)};</script>`);
        }

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
