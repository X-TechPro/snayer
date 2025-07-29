// Next.js API route for /api/movie
// Adapted from original Vercel handler

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { Readable } from 'stream';

// Store progress for each request (in-memory, per tmdb id)
const progressMap = new Map();

function getProviders(tmdb_id) {
    return [
        { name: 'Vidsrc', url: `https://player.vidsrc.co/embed/movie/${tmdb_id}` },
        { name: 'Vidsrc.vip', url: `https://vidsrc.vip/embed/movie/${tmdb_id}` },
        { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/movie/${tmdb_id}` },
        { name: 'UEmbed', url: `https://uembed.site/?id=${tmdb_id}` },
        { name: 'P-Stream', url: `https://iframe.pstream.org/embed/tmdb-movie-${tmdb_id}` },
    ];
}

async function sniffStreamUrl(tmdb_id, browserlessToken, onStatus) {
    if (!browserlessToken) {
        throw new Error('Missing BROWSERLESS_TOKEN environment variable or api param.');
    }
    const browserWSEndpoint = `wss://production-lon.browserless.io?token=${browserlessToken}`;
    const providers = getProviders(tmdb_id);
    for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        if (onStatus) onStatus(i, 'loading');
        let finalUrl = null;
        try {
            const browser = await puppeteer.connect({ browserWSEndpoint });
            const page = await browser.newPage();
            let mp4Info = [];
            let m3u8Info = [];
            await page.setRequestInterception(true);
            page.on('request', req => {
                // If scraping vidsrc.vip, set Origin and Referer headers
                if (provider.name === 'Vidsrc.vip' || (req.url().includes('vidsrc.vip') || req.url().includes('niggaflix.xyz'))) {
                    const headers = Object.assign({}, req.headers(), {
                        'Origin': 'https://vidsrc.vip',
                        'Referer': 'https://vidsrc.vip/'
                    });
                    req.continue({ headers });
                } else {
                    req.continue();
                }
            });
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
            await page.goto(provider.url, { waitUntil: 'networkidle2', timeout: 60000 });
            await new Promise(r => setTimeout(r, 3000));
            if (mp4Info.length) {
                finalUrl = mp4Info.sort((a, b) => (b.size - a.size) || (b.url.length - a.url.length))[0]?.url;
            } else if (m3u8Info.length) {
                finalUrl = m3u8Info.sort((a, b) => b.time - a.time)[0]?.url;
            }
            await browser.close();
        } catch (e) {
            // ignore error, mark as error
        }
        if (finalUrl) {
            if (onStatus) onStatus(i, 'completed', finalUrl);
            return finalUrl;
        } else {
            if (onStatus) onStatus(i, 'error');
        }
    }
    return null;
}

export default async function handler(req, res) {
    const { tmdb, api, title, progress, url } = req.query;

    // Proxy endpoint for vidsrc.vip, niggaflix.xyz, and vidsrc.co URLs
    if (url && (url.includes('vidsrc.vip') || url.includes('niggaflix.xyz') || url.includes('vidsrc.co'))) {
        try {
            let targetUrl = url;
            let headers = {};
            if (url.includes('vidsrc.vip') || url.includes('niggaflix.xyz')) {
                headers = {
                    'Origin': 'https://vidsrc.vip',
                    'Referer': 'https://vidsrc.vip/',
                    ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
                };
            } else if (url.includes('vidsrc.co')) {
                // If it's a proxy.vidsrc.co link, extract the 'u' param
                const match = url.match(/proxy\.vidsrc\.co\/\?u=([^&]+)/);
                if (match) {
                    // Decode the base mp4 url
                    targetUrl = decodeURIComponent(match[1]);
                }
                headers = {
                    'Origin': 'https://moviebox.ng',
                    'Referer': 'https://moviebox.ng',
                    ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
                };
            }
            const response = await fetch(targetUrl, { headers });
            res.status(response.status);
            for (const [key, value] of response.headers.entries()) {
                res.setHeader(key, value);
            }
            const readable = Readable.from(response.body);
            readable.pipe(res);
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
        // Send initial state
        let state = progressMap.get(tmdb) || { statuses: ["pending", "pending", "pending", "pending"], found: null };
        res.write(`data: ${JSON.stringify(state)}\n\n`);
        // Poll for updates
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
        const htmlPath = path.join(process.cwd(), 'public', 'popup.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        res.setHeader('content-type', 'text/html');
        res.send(html);
        // Start sniffing in background
        (async () => {
            const browserlessToken = api || process.env.BROWSERLESS_TOKEN;
            const providers = getProviders(tmdb);
            let statuses = ["pending", "pending", "pending", "pending"];
            let found = null;
            progressMap.set(tmdb, { statuses, found });
            await sniffStreamUrl(tmdb, browserlessToken, (idx, status, url) => {
                statuses[idx] = status;
                if (status === 'completed' && url) {
                    found = url;
                }
                progressMap.set(tmdb, { statuses: [...statuses], found });
            });
            // After done, keep result for a short time
            setTimeout(() => progressMap.delete(tmdb), 60000);
        })();
        return;
    }

    // Serve the HTML page
    const serveHtmlPage = (streamUrl = null, pageTitle = null) => {
        const htmlPath = path.join(process.cwd(), 'public', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        // Inject Tailwind loading overlay and script
        const loadingOverlay = `\n<div id=\"loading-overlay\" class=\"fixed inset-0 flex items-center justify-center bg-black bg-opacity-80 z-50\">\n  <div class=\"flex flex-col items-center\">\n    <svg class=\"animate-spin h-12 w-12 text-white mb-4\" xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><circle class=\"opacity-25\" cx=\"12\" cy=\"12\" r=\"10\" stroke=\"currentColor\" stroke-width=\"4\"></circle><path class=\"opacity-75\" fill=\"currentColor\" d=\"M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z\"></path></svg>\n    <span class=\"text-white text-lg font-semibold\">Sniffing for stream providers... Please wait</span>\n  </div>\n</div>\n<script>\n(function() {\n  function hideOverlay() {\n    const overlay = document.getElementById('loading-overlay');\n    if (overlay) overlay.style.display = 'none';\n  }\n  if (window.source) {\n    hideOverlay();\n  } else {\n    const observer = new MutationObserver(() => {\n      if (window.source) {\n        hideOverlay();\n        observer.disconnect();\n      }\n    });\n    observer.observe(document.documentElement, { subtree: true, childList: true });\n    window.addEventListener('source-ready', hideOverlay);\n  }\n})();\n</script>\n`;
        html = html.replace('<body>', `<body>\n${loadingOverlay}`);
        if (streamUrl) {
            html = html.replace('const { source } = await fetch(\'/config\').then(r => r.json());', `const source = '${streamUrl}';`);
            html = html.replace('const proxyUrl = url => `/stream?url=${encodeURIComponent(url)}`;', `const proxyUrl = url => '/api/movie?url=' + encodeURIComponent(url);`);
        }
        // Inject the title as a JS variable for the frontend
        if (pageTitle) {
            // Insert after <script> tag for Lucide (early in <head>)
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(pageTitle)};</script>`);
        }
        if (streamUrl) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(streamUrl)};window.dispatchEvent(new Event('source-ready'));</script>`);
        }
        res.setHeader('content-type', 'text/html');
        res.send(html);
    };

    if (!tmdb) {
        return serveHtmlPage();
    }

    if (!tmdb) return res.status(400).send('Missing tmdb param');
    const browserlessToken = api || process.env.BROWSERLESS_TOKEN;
    console.log('browserlessToken:', browserlessToken);
    let streamUrl;
    try {
        streamUrl = await sniffStreamUrl(tmdb, browserlessToken);
    } catch (e) {
        return res.status(500).send('Stream sniffing failed: ' + e.message);
    }
    if (!streamUrl) return res.status(404).send('No stream found');
    serveHtmlPage(streamUrl, title);
}
