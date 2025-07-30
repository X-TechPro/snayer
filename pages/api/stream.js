// Next.js API route for /api/stream

// Refactored stream API using centralized utilities
const { fetchSubtitles } = require('../../lib/subtitles');
const { readHtml, injectHtml } = require('../../lib/html');
const { proxyStream } = require('../../lib/proxy');

export default async function handler(req, res) {
    const { title, tmdb } = req.query;
    const url = req.query.url ? decodeURIComponent(req.query.url) : undefined;

    // If mbox=1 and raw=1, proxy the video file with required headers (for player fetch)
    if (url && req.query.mbox === '1' && req.query.raw === '1') {
        if (!url.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }
        const headers = {
            'Origin': 'https://moviebox.ng',
            'Referer': 'https://moviebox.ng',
            ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
        };
        return proxyStream({ req, res, url, headers });
    }

    // If mbox=1, serve index.html and inject window.source as the proxy endpoint
    if (url && req.query.mbox === '1') {
        let html = readHtml('index.html');
        const proxyUrl = `/api/stream?url=${encodeURIComponent(url)}&mbox=1&raw=1`;
        let subtitles = await fetchSubtitles(tmdb);
        html = injectHtml(html, { source: proxyUrl, title, subtitles, mboxHeaders: true });
        res.setHeader('content-type', 'text/html');
        res.send(html);
        return;
    }

    // Otherwise, serve index.html as before
    let html = readHtml('index.html');
    let subtitles = await fetchSubtitles(tmdb);
    if (url) {
        if (!url.startsWith('http')) {
            return res.status(400).send('Invalid URL');
        }
        html = injectHtml(html, { source: url, title, subtitles });
    }
    res.setHeader('content-type', 'text/html');
    res.send(html);
}
