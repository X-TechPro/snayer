// Next.js API route for /api/movie
// Adapted from original Vercel handler


import { proxyStream, getProxyHeaders } from './shared/proxy';
import { serveHtml } from './shared/html';
import { sniffStreamUrl, getProviders } from './shared/sniff';
import { getProgress, setProgress, clearProgress } from './shared/progress';


export default async function handler(req, res) {
    const { tmdb, api, title, progress, url } = req.query;

    // Proxy endpoint for vidsrc.vip, niggaflix.xyz, and mbox links
    if (url && (url.includes('vidsrc.vip') || url.includes('niggaflix.xyz') || req.query.mbox === '1')) {
        const type = req.query.mbox === '1' ? 'mbox' : 'vidsrc';
        const headers = getProxyHeaders(type, req);
        try {
            await proxyStream(req, res, url, headers);
        } catch (err) {
            res.status(500).send('Proxy error: ' + err.message);
        }
        return;
    }

    // SSE endpoint for progress
    if (progress && tmdb) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        let state = getProgress(tmdb);
        res.write(`data: ${JSON.stringify(state)}\n\n`);
        const interval = setInterval(() => {
            let state = getProgress(tmdb);
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
        serveHtml(res, 'popup.html');
        (async () => {
            const browserlessToken = api || process.env.BROWSERLESS_TOKEN;
            let statuses = ["pending", "pending", "pending", "pending"];
            let found = null;
            setProgress(tmdb, statuses, found);
            await sniffStreamUrl('movie', tmdb, browserlessToken, (idx, status, url) => {
                statuses[idx] = status;
                if (status === 'completed' && url) {
                    found = url;
                }
                setProgress(tmdb, statuses, found);
            });
            setTimeout(() => clearProgress(tmdb), 60000);
        })();
        return;
    }

    // Serve the HTML page
    const loadingOverlay = `\n<div id=\"loading-overlay\" class=\"fixed inset-0 flex items-center justify-center bg-black bg-opacity-80 z-50\">\n  <div class=\"flex flex-col items-center\">\n    <svg class=\"animate-spin h-12 w-12 text-white mb-4\" xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><circle class=\"opacity-25\" cx=\"12\" cy=\"12\" r=\"10\" stroke=\"currentColor\" stroke-width=\"4\"></circle><path class=\"opacity-75\" fill=\"currentColor\" d=\"M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z\"></path></svg>\n    <span class=\"text-white text-lg font-semibold\">Sniffing for stream providers... Please wait</span>\n  </div>\n</div>\n<script>\n(function() {\n  function hideOverlay() {\n    const overlay = document.getElementById('loading-overlay');\n    if (overlay) overlay.style.display = 'none';\n  }\n  if (window.source) {\n    hideOverlay();\n  } else {\n    const observer = new MutationObserver(() => {\n      if (window.source) {\n        hideOverlay();\n        observer.disconnect();\n      }\n    });\n    observer.observe(document.documentElement, { subtree: true, childList: true });\n    window.addEventListener('source-ready', hideOverlay);\n  }\n})();\n</script>\n`;
    if (!tmdb) {
        serveHtml(res, 'index.html', { loadingOverlay });
        return;
    }

    if (!tmdb) return res.status(400).send('Missing tmdb param');
    const browserlessToken = api || process.env.BROWSERLESS_TOKEN;
    let streamUrl;
    try {
        streamUrl = await sniffStreamUrl('movie', tmdb, browserlessToken);
    } catch (e) {
        return res.status(500).send('Stream sniffing failed: ' + e.message);
    }
    if (!streamUrl) return res.status(404).send('No stream found');
    serveHtml(res, 'index.html', { loadingOverlay, streamUrl, pageTitle: title });
}
