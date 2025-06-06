// Next.js API route for /api/movie
// Adapted from original Vercel handler

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

function getProviders(tmdb_id) {
    return [
        `https://player.vidsrc.co/embed/movie/${tmdb_id}`,
        `https://player.autoembed.cc/embed/movie/${tmdb_id}`,
        `https://uembed.site/?id=${tmdb_id}`,
        `https://iframe.pstream.org/embed/tmdb-movie-${tmdb_id}`,
    ];
}

async function sniffStreamUrl(tmdb_id, browserlessToken) {
    if (!browserlessToken) {
        throw new Error('Missing BROWSERLESS_TOKEN environment variable or api param.');
    }
    const browserWSEndpoint = `wss://production-lon.browserless.io?token=${browserlessToken}`;
    const providers = getProviders(tmdb_id);
    for (const EMBED_URL of providers) {
        console.log('Connecting to:', browserWSEndpoint);
        const browser = await puppeteer.connect({ browserWSEndpoint });
        console.log('Connected!');
        const page = await browser.newPage();
        let mp4Info = [];
        let m3u8Info = [];
        await page.setRequestInterception(true);
        page.on('request', req => req.continue());
        page.on('response', async response => {
            const url = response.url();
            const headers = response.headers();
            const len = headers['content-length'] ? parseInt(headers['content-length']) : 0;
            if (url.includes('.mp4')) {
                mp4Info.push({ url, size: len });
            }
            if (url.includes('.m3u8')) {
                m3u8Info.push({ url, time: Date.now() });
            }
        });
        await page.goto(EMBED_URL, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));
        let finalUrl = null;
        if (mp4Info.length) {
            finalUrl = mp4Info.sort((a, b) => (b.size - a.size) || (b.url.length - a.url.length))[0]?.url;
        } else if (m3u8Info.length) {
            // Pick the newest m3u8 (last one seen)
            finalUrl = m3u8Info.sort((a, b) => b.time - a.time)[0]?.url;
        }
        await browser.close();
        if (finalUrl) {
            return finalUrl;
        }
    }
    return null;
}

export default async function handler(req, res) {
    const { tmdb, api, title } = req.query;

    // Serve the HTML page (always with spinner, never inject streamUrl directly)
    const serveHtmlPage = (pageTitle = null) => {
        const htmlPath = path.join(process.cwd(), 'public', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        // Inject Tailwind loading overlay and script
        const loadingOverlay = `\n<div id=\"loading-overlay\" class=\"fixed inset-0 flex items-center justify-center bg-black bg-opacity-80 z-50\">\n  <div class=\"flex flex-col items-center\">\n    <svg class=\"animate-spin h-12 w-12 text-white mb-4\" xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><circle class=\"opacity-25\" cx=\"12\" cy=\"12\" r=\"10\" stroke=\"currentColor\" stroke-width=\"4\"></circle><path class=\"opacity-75\" fill=\"currentColor\" d=\"M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z\"></path></svg>\n    <span class=\"text-white text-lg font-semibold\">Sniffing for stream providers... Please wait</span>\n  </div>\n</div>\n<script>\n(function() {\n  function hideOverlay() {\n    const overlay = document.getElementById('loading-overlay');\n    if (overlay) overlay.style.display = 'none';\n  }\n  window.hideLoadingOverlay = hideOverlay;\n})();\n</script>\n`;
        html = html.replace('<body>', `<body>\n${loadingOverlay}`);
        // Inject the title as a JS variable for the frontend
        if (pageTitle) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(pageTitle)};</script>`);
        }
        // Inject script to fetch stream after load
        const sniffScript = `\n<script>\n(async function() {\n  const urlParams = new URLSearchParams(window.location.search);\n  const tmdb = urlParams.get('tmdb');\n  if (!tmdb) return;\n  try {\n    const api = urlParams.get('api');\n    const title = urlParams.get('title');\n    let sniffUrl = '/api/movie?tmdb=' + encodeURIComponent(tmdb);
        if (api) sniffUrl += '&api=' + encodeURIComponent(api);
        if (title) sniffUrl += '&title=' + encodeURIComponent(title);
        const resp = await fetch(sniffUrl, { headers: { accept: 'application/json' } });\n    if (!resp.ok) throw new Error(await resp.text());\n    const data = await resp.json();\n    if (data.source) {\n      window.source = data.source;\n      window.dispatchEvent(new Event('source-ready'));
      if (window.hideLoadingOverlay) window.hideLoadingOverlay();\n    } else {\n      throw new Error('No stream found');\n    }\n  } catch (e) {\n    document.getElementById('loading-overlay').innerHTML = '<span class="text-white">' + e.message + '</span>';
  }\n})();\n</script>\n`;
        html = html.replace('</body>', `${sniffScript}\n</body>`);
        res.setHeader('content-type', 'text/html');
        res.send(html);
    };

    // If not an AJAX sniff request, always serve HTML (with spinner)
    if (!req.headers.accept || !req.headers.accept.includes('application/json')) {
        return serveHtmlPage(title);
    }

    // AJAX sniff request: return JSON with stream url
    if (!tmdb) return res.status(400).json({ error: 'Missing tmdb param' });
    const browserlessToken = api || process.env.BROWSERLESS_TOKEN;
    let streamUrl;
    try {
        streamUrl = await sniffStreamUrl(tmdb, browserlessToken);
    } catch (e) {
        return res.status(500).json({ error: 'Stream sniffing failed: ' + e.message });
    }
    if (!streamUrl) return res.status(404).json({ error: 'No stream found' });
    res.json({ source: streamUrl });
}
