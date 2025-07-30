// HTML utilities for /api endpoints
import fs from 'fs';
import path from 'path';

export function serveHtml(res, file = 'index.html', options = {}) {
    const htmlPath = path.join(process.cwd(), 'public', file);
    let html = fs.readFileSync(htmlPath, 'utf8');
    if (options.loadingOverlay) {
        html = html.replace('<body>', `<body>\n${options.loadingOverlay}`);
    }
    if (options.streamUrl) {
        html = html.replace('const { source } = await fetch(\'/config\').then(r => r.json());', `const source = '${options.streamUrl}';`);
        html = html.replace('const proxyUrl = url => `/stream?url=${encodeURIComponent(url)}`;', `const proxyUrl = url => '/api/movie?url=' + encodeURIComponent(url);`);
    }
    if (options.pageTitle) {
        html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(options.pageTitle)};</script>`);
    }
    if (options.streamUrl) {
        html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(options.streamUrl)};window.dispatchEvent(new Event('source-ready'));</script>`);
    }
    if (options.subtitles) {
        html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__SUBTITLES__ = ${JSON.stringify(options.subtitles)};</script>`);
    }
    res.setHeader('content-type', 'text/html');
    res.send(html);
}
