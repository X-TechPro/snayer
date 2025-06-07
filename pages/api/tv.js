// Next.js API route for /api/tv
// Adapted from original Vercel handler

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { Readable } from 'stream';

// Store progress for each request (in-memory, per tmdb id/season/episode)
const progressMap = new Map();

function getProgressKey(tmdb, season, episode) {
    return `${tmdb}:${season}:${episode}`;
}

function getProviders(tmdb_id, season, episode) {
    return [
        `https://player.vidsrc.co/embed/tv/${tmdb_id}/${season}/${episode}`,
        `https://player.autoembed.cc/embed/tv/${tmdb_id}/${season}/${episode}`,
        `https://uembed.site/?id=${tmdb_id}&season=${season}&episode=${episode}`,
        `https://iframe.pstream.org/embed/tmdb-tv-${tmdb_id}/${season}/${episode}`,
    ];
}

async function sniffStreamUrl(tmdb_id, season, episode, browserlessToken, onStatus) {
    if (!browserlessToken) {
        throw new Error('Missing BROWSERLESS_TOKEN environment variable or api param.');
    }
    const browserWSEndpoint = `wss://production-lon.browserless.io?token=${browserlessToken}`;
    const providers = getProviders(tmdb_id, season, episode);
    for (let i = 0; i < providers.length; i++) {
        const EMBED_URL = providers[i];
        if (onStatus) onStatus(i, 'loading');
        let finalUrl = null;
        try {
            const browser = await puppeteer.connect({ browserWSEndpoint });
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
    const { tmdb, api, title, s, e, progress } = req.query;
    // Parse season and episode, default to 1 if not provided
    const season = s ? parseInt(s, 10) : 1;
    const episode = e ? parseInt(e, 10) : 1;
    const progressKey = getProgressKey(tmdb, season, episode);

    // SSE endpoint for progress
    if (progress && tmdb) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        // Send initial state
        let state = progressMap.get(progressKey) || { statuses: ["pending", "pending", "pending", "pending"], found: null };
        res.write(`data: ${JSON.stringify(state)}\n\n`);
        // Poll for updates
        const interval = setInterval(() => {
            let state = progressMap.get(progressKey);
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
    if (tmdb && !progress) {
        const htmlPath = path.join(process.cwd(), 'public', 'popup.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        res.setHeader('content-type', 'text/html');
        res.send(html);
        // Start sniffing in background
        (async () => {
            const browserlessToken = api || process.env.BROWSERLESS_TOKEN;
            const providers = getProviders(tmdb, season, episode);
            let statuses = ["pending", "pending", "pending", "pending"];
            let found = null;
            progressMap.set(progressKey, { statuses, found });
            await sniffStreamUrl(tmdb, season, episode, browserlessToken, (idx, status, url) => {
                statuses[idx] = status;
                if (status === 'completed' && url) {
                    found = url;
                }
                progressMap.set(progressKey, { statuses: [...statuses], found });
            });
            // After done, keep result for a short time
            setTimeout(() => progressMap.delete(progressKey), 60000);
        })();
        return;
    }

    // Fetch subtitles from madplay.site
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
        // Inject subtitles as a JS variable
        html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__SUBTITLES__ = ${JSON.stringify(subtitles)};</script>`);
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
        streamUrl = await sniffStreamUrl(tmdb, season, episode, browserlessToken);
    } catch (e) {
        return res.status(500).send('Stream sniffing failed: ' + e.message);
    }
    if (!streamUrl) return res.status(404).send('No stream found');
    serveHtmlPage(streamUrl, title);
}
