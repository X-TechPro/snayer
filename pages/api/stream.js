// Next.js API route for /api/stream

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

export default async function handler(req, res) {
    const { url, title } = req.query;

    // Serve the HTML page if no url param
    if (!url) {
        const htmlPath = path.join(process.cwd(), 'public', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        res.setHeader('content-type', 'text/html');
        res.send(html);
        return;
    }

    if (!url.startsWith('http')) {
        return res.status(400).send('Invalid URL');
    }

    // If the request is for the player page (not the video stream itself)
    if (!req.headers.range) {
        // Serve index.html with the video source set to this endpoint
        const htmlPath = path.join(process.cwd(), 'public', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        html = html.replace('const { source } = await fetch(\'/config\').then(r => r.json());', `const source = '/api/stream?url=${encodeURIComponent(url)}&raw=1';`);
        html = html.replace('const proxyUrl = url => `/stream?url=${encodeURIComponent(url)}`;', `const proxyUrl = url => '/api/stream?url=' + encodeURIComponent(url) + '&raw=1';`);
        if (title) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(title)};</script>`);
        }
        res.setHeader('content-type', 'text/html');
        res.send(html);
        return;
    }

    // If ?raw=1, stream the video file from the remote url
    if (req.query.raw === '1') {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (streamRes) => {
            // Forward headers for range requests
            res.writeHead(streamRes.statusCode, streamRes.headers);
            streamRes.pipe(res);
        }).on('error', (err) => {
            res.status(500).send('Stream error: ' + err.message);
        });
        return;
    }

    // Default: serve the player page
    const htmlPath = path.join(process.cwd(), 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace('const { source } = await fetch(\'/config\').then(r => r.json());', `const source = '/api/stream?url=${encodeURIComponent(url)}&raw=1';`);
    html = html.replace('const proxyUrl = url => `/stream?url=${encodeURIComponent(url)}`;', `const proxyUrl = url => '/api/stream?url=' + encodeURIComponent(url) + '&raw=1';`);
    if (title) {
        html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(title)};</script>`);
    }
    res.setHeader('content-type', 'text/html');
    res.send(html);
}
