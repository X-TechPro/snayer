// Next.js API route for /api/movie
// Adapted from original Vercel handler

// Refactored tv API using centralized utilities
const { sniffStreamUrl } = require('../../lib/scraper');
const { fetchSubtitles } = require('../../lib/subtitles');
const { readHtml, injectHtml } = require('../../lib/html');
const { proxyStream } = require('../../lib/proxy');

const progressMap = new Map();

export default async function handler(req, res) {
    const { tmdb, api, title, progress, s, e, url } = req.query;

    // Proxy endpoint for vidsrc.vip and niggaflix.xyz URLs
    if (url && (url.includes('vidsrc.vip') || url.includes('niggaflix.xyz'))) {
        const headers = {
            'Origin': 'https://vidsrc.vip',
            'Referer': 'https://vidsrc.vip/',
            ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
        };
        return proxyStream({ req, res, url, headers });
    }

    // Parse season and episode from query (default to 1 if not provided)
    const season = s ? parseInt(s, 10) : 1;
    const episode = e ? parseInt(e, 10) : 1;

    // SSE endpoint for progress
    if (progress && tmdb) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        let state = progressMap.get(tmdb) || { statuses: ["pending", "pending", "pending", "pending", "pending"], found: null };
        res.write(`data: ${JSON.stringify(state)}\n\n`);
        const interval = setInterval(() => {
            let state = progressMap.get(tmdb);
            if (state) {
                res.write(`data: ${JSON.stringify(state)}\n\n`);
                if (state.found !== null || state.statuses.every(s => s === 'completed' || s === 'error')) {
                    clearInterval(interval);
                    res.end();
                }
            }
        }, 1000);
        req.on('close', () => clearInterval(interval));
        return;
    }

    // Serve popup.html immediately if tmdb param is present
    if (tmdb) {
        let html = readHtml('popup.html');
        res.setHeader('content-type', 'text/html');
        res.send(html);
        // Start sniffing in background
        (async () => {
            const browserlessToken = api || process.env.BROWSERLESS_TOKEN;
            let statuses = ["pending", "pending", "pending", "pending", "pending"];
            let found = null;
            progressMap.set(tmdb, { statuses, found });
            await sniffStreamUrl({ tmdb, token: browserlessToken, type: 'tv', season, episode, onStatus: (idx, status, url) => {
                statuses[idx] = status;
                if (status === 'completed' && url) {
                    found = url;
                }
                progressMap.set(tmdb, { statuses: [...statuses], found });
            }});
            setTimeout(() => progressMap.delete(tmdb), 60000);
        })();
        return;
    }

    // Serve the HTML page
    const serveHtmlPage = async (streamUrl = null, pageTitle = null) => {
        let html = readHtml('index.html');
        let subtitles = await fetchSubtitles(tmdb);
        const overlay = `\n<div id=\"loading-overlay\" class=\"fixed inset-0 flex items-center justify-center bg-black bg-opacity-80 z-50\">\n  <div class=\"flex flex-col items-center\">\n    <svg class=\"animate-spin h-12 w-12 text-white mb-4\" xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><circle class=\"opacity-25\" cx=\"12\" cy=\"12\" r=\"10\" stroke=\"currentColor\" stroke-width=\"4\"></circle><path class=\"opacity-75\" fill=\"currentColor\" d=\"M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z\"></path></svg>\n    <span class=\"text-white text-lg font-semibold\">Sniffing for stream providers... Please wait</span>\n  </div>\n</div>\n<script>\n(function() {\n  function hideOverlay() {\n    const overlay = document.getElementById('loading-overlay');\n    if (overlay) overlay.style.display = 'none';\n  }\n  if (window.source) {\n    hideOverlay();\n  } else {\n    const observer = new MutationObserver(() => {\n      if (window.source) {\n        hideOverlay();\n        observer.disconnect();\n      }\n    });\n    observer.observe(document.documentElement, { subtree: true, childList: true });\n    window.addEventListener('source-ready', hideOverlay);\n  }\n})();\n</script>\n`;
        html = injectHtml(html, { source: streamUrl, title: pageTitle, subtitles, overlay });
        res.setHeader('content-type', 'text/html');
        res.send(html);
    };

    if (!tmdb) {
        return serveHtmlPage();
    }

    if (!tmdb) return res.status(400).send('Missing tmdb param');
    const browserlessToken = api || process.env.BROWSERLESS_TOKEN;
    let streamUrl;
    try {
        streamUrl = await sniffStreamUrl({ tmdb, token: browserlessToken, type: 'tv', season, episode });
    } catch (e) {
        return res.status(500).send('Stream sniffing failed: ' + e.message);
    }
    if (!streamUrl) return res.status(404).send('No stream found');
    await serveHtmlPage(streamUrl, title);
}
