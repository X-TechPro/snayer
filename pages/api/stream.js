// Next.js API route for /api/stream

import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
    const { url, title } = req.query;

    const htmlPath = path.join(process.cwd(), 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    if (url) {
        if (!url.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }
        // Inject the video source and title into the HTML for the player
        html = html.replace('const { source } = await fetch(\'/config\').then(r => r.json());', `const source = '${url}';`);
        html = html.replace('const proxyUrl = url => `/stream?url=${encodeURIComponent(url)}`;', `const proxyUrl = url => '/api/stream?url=' + encodeURIComponent(url);`);
        if (title) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(title)};</script>`);
        }
    }

    res.setHeader('content-type', 'text/html');
    res.send(html);
}
