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

export async function sniffStreamUrl(tmdb_id, browserlessToken) {
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
        // Inject the title and sniffing logic
        const sniffScript = `
            <script>
                // Set the title if provided
                ${pageTitle ? `window.__PLAYER_TITLE__ = ${JSON.stringify(pageTitle)};` : ''}
                
                // Function to start sniffing
                async function startSniffing() {
                    try {
                        const response = await fetch('/api/sniff?tmdb=${encodeURIComponent(tmdb)}${api ? '&api=' + encodeURIComponent(api) : ''}${title ? '&title=' + encodeURIComponent(title) : ''}');
                        if (!response.ok) throw new Error('Sniffing failed');
                        
                        const { streamUrl } = await response.json();
                        if (streamUrl) {
                            window.source = streamUrl;
                            window.dispatchEvent(new Event('source-ready'));
                        } else {
                            throw new Error('No stream found');
                        }
                    } catch (error) {
                        console.error('Sniffing error:', error);
                        const overlay = document.getElementById('loading-overlay');
                        if (overlay) {
                            const errorMessage = error.message || 'Please try again later';
                            overlay.innerHTML = [
                                '<div class="flex flex-col items-center">',
                                '  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500">',
                                '    <circle cx="12" cy="12" r="10"></circle>',
                                '    <line x1="12" y1="8" x2="12" y2="12"></line>',
                                '    <line x1="12" y1="16" x2="12.01" y2="16"></line>',
                                '  </svg>',
                                '  <span class="text-white text-lg font-semibold mt-4">Failed to load stream</span>',
                                '  <p class="text-gray-300 mt-2">' + errorMessage + '</p>',
                                '  <button onclick="window.location.reload()" class="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors">',
                                '    Retry',
                                '  </button>',
                                '</div>'
                            ].join('\n');
                        }
                    }
                }

                // Start sniffing when the page is fully loaded
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', startSniffing);
                } else {
                    startSniffing();
                }
            </script>
        `;
        
        // Insert the sniffing script after Lucide
        html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', 
            `<script src="https://unpkg.com/lucide@latest"></script>\n${sniffScript}`);
            
        // If we already have a stream URL, set it directly
        if (streamUrl) {
            html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', 
                `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = ${JSON.stringify(streamUrl)};window.dispatchEvent(new Event('source-ready'));</script>`);
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
