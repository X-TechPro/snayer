// HTML reading and injection utility
const fs = require('fs');
const path = require('path');

function readHtml(template) {
    const htmlPath = path.join(process.cwd(), 'public', template);
    return fs.readFileSync(htmlPath, 'utf8');
}

function injectHtml(html, { source, title, subtitles, overlay, mboxHeaders }) {
    let injected = html;
    if (overlay) {
        injected = injected.replace('<body>', `<body>\n${overlay}`);
    }
    if (source) {
        injected = injected.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(source)};<\/script>`);
    }
    if (title) {
        injected = injected.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(title)};<\/script>`);
    }
    if (subtitles && subtitles.length) {
        injected = injected.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__SUBTITLES__ = ${JSON.stringify(subtitles)};<\/script>`);
    }
    if (mboxHeaders) {
        injected = injected.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__MBOX_HEADERS__ = true;<\/script>`);
    }
    return injected;
}

module.exports = { readHtml, injectHtml };
