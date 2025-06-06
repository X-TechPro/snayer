// Next.js API route for /api/tv
// Adapted from original Vercel handler

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

function getProviders(tmdb_id, season, episode) {
    return [
        `https://player.vidsrc.co/embed/tv/${tmdb_id}/${season}/${episode}`,
        `https://player.autoembed.cc/embed/tv/${tmdb_id}/${season}/${episode}`,
        `https://uembed.site/?id=${tmdb_id}&season=${season}&episode=${episode}`,
        `https://iframe.pstream.org/embed/tmdb-tv-${tmdb_id}/${season}/${episode}`,
    ];
}

async function sniffStreamUrl(tmdb_id, season, episode, browserlessToken) {
    if (!browserlessToken) {
        throw new Error('Missing BROWSERLESS_TOKEN environment variable or api param.');
    }
    const browserWSEndpoint = `wss://production-lon.browserless.io?token=${browserlessToken}`;
    const providers = getProviders(tmdb_id, season, episode);
    let sniffProgress = ["pending", "pending", "pending", "pending"];
    for (let i = 0; i < providers.length; i++) {
        const EMBED_URL = providers[i];
        // Update popup: set current to loading
        sniffProgress[i] = "loading";
        if (typeof globalThis.res !== 'undefined' && globalThis.res.__providerPopupUpdate) {
            await globalThis.res.__providerPopupUpdate(i, "loading");
        }
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
        let finalUrl = null;
        if (mp4Info.length) {
            finalUrl = mp4Info.sort((a, b) => (b.size - a.size) || (b.url.length - a.url.length))[0]?.url;
        } else if (m3u8Info.length) {
            finalUrl = m3u8Info.sort((a, b) => b.time - a.time)[0]?.url;
        }
        await browser.close();
        // Update popup: set current to completed/error
        sniffProgress[i] = finalUrl ? "completed" : "error";
        if (typeof globalThis.res !== 'undefined' && globalThis.res.__providerPopupUpdate) {
            await globalThis.res.__providerPopupUpdate(i, sniffProgress[i]);
        }
        if (finalUrl) {
            // Hide popup
            if (typeof globalThis.res !== 'undefined' && globalThis.res.__providerPopupHide) {
                await globalThis.res.__providerPopupHide();
            }
            return finalUrl;
        }
    }
    // Hide popup if all failed
    if (typeof globalThis.res !== 'undefined' && globalThis.res.__providerPopupHide) {
        await globalThis.res.__providerPopupHide();
    }
    return null;
}

// Helper: HTML for animated provider popup (matches loading-popup.tsx style)
function getProviderPopupHtml(providers) {
  // providers: array of {name, status}
  const statusHtml = {
    pending: (name) => `<div class=\"flex items-center gap-2 rounded-full bg-gray-700/50 px-3 py-1\"><div class=\"h-2 w-2 rounded-full bg-[#0099ff]/60\"></div><span class=\"text-sm text-[#0099ff]/80 font-medium\">Pending</span></div>`,
    loading: (name) => `<div class=\"flex items-center gap-2 rounded-full bg-[#0099ff]/10 px-3 py-1\"><svg class=\"h-4 w-4 animate-spin text-[#0099ff]\" fill=\"none\" viewBox=\"0 0 24 24\"><circle class=\"opacity-25\" cx=\"12\" cy=\"12\" r=\"10\" stroke=\"#0099ff\" stroke-width=\"4\"></circle><path class=\"opacity-75\" fill=\"#0099ff\" d=\"M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z\"></path></svg><span class=\"text-sm text-[#0099ff] font-medium\">Processing</span></div>`,
    completed: (name) => `<div class=\"flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1\"><svg class=\"h-4 w-4 text-green-500\" fill=\"none\" viewBox=\"0 0 24 24\"><path stroke=\"#22c55e\" stroke-width=\"2\" d=\"M5 13l4 4L19 7\"/></svg><span class=\"text-sm text-green-500 font-medium\">Complete</span></div>`,
    error: (name) => `<div class=\"flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1\"><svg class=\"h-4 w-4 text-red-500\" fill=\"none\" viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"10\" stroke=\"#ef4444\" stroke-width=\"2\"/><line x1=\"12\" y1=\"8\" x2=\"12\" y2=\"12\" stroke=\"#ef4444\" stroke-width=\"2\"/><circle cx=\"12\" cy=\"16\" r=\"1\" fill=\"#ef4444\"/></svg><span class=\"text-sm text-red-500 font-medium\">Failed</span></div>`
  };
  function getContainerRounding(index, total) {
    if (index === 0) return "rounded-t-xl rounded-b-sm";
    if (index === total - 1) return "rounded-b-xl rounded-t-sm";
    return "rounded-sm";
  }
  return `
  <div id=\"provider-popup-overlay\" class=\"fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm\">
    <div class=\"relative w-full max-w-md h-[90vh] overflow-hidden rounded-2xl bg-gradient-to-br from-black to-gray-900 shadow-2xl transition-all duration-500 flex flex-col\">
      <div class=\"absolute inset-0 bg-gradient-to-br from-[#0099ff]/5 via-transparent to-purple-500/5\"></div>
      <div class=\"absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,153,255,0.1),transparent_50%)]\"></div>
      <div class=\"absolute inset-0 rounded-2xl bg-gradient-to-r from-[#0099ff]/20 via-transparent to-[#0099ff]/20 p-px\">
        <div class=\"h-full w-full rounded-2xl bg-gradient-to-br from-black to-gray-900\"></div>
      </div>
      <div class=\"relative p-8 pb-6 flex-shrink-0\">
        <div class=\"flex items-center justify-between mb-6\">
          <h2 class=\"bg-gradient-to-r from-[#0099ff] to-cyan-400 bg-clip-text text-2xl font-bold text-transparent tracking-wide\">Scraping Providers</h2>
          <div class=\"rounded-full bg-[#0099ff]/10 px-3 py-1 text-sm text-[#0099ff] font-medium backdrop-blur-sm\">
            ${providers.filter(p => p.status === 'completed').length} / ${providers.length}
          </div>
        </div>
        <div class=\"h-px bg-gradient-to-r from-transparent via-white/30 to-transparent shadow-sm\"></div>
      </div>
      <div class=\"relative flex-1 px-8 pb-8 overflow-y-auto\">
        <div class=\"space-y-px\">
          ${providers.map((p, i) => `<div class=\"relative overflow-hidden ${getContainerRounding(i, providers.length)} bg-gradient-to-r from-gray-900/50 to-gray-800/30 p-4 backdrop-blur-sm\" style=\"animation-delay:${i*100}ms;animation:fadeInUp 0.6s ease-out forwards;\"><div class=\"relative flex items-center justify-between\"><span class=\"text-lg font-semibold text-[#0099ff] tracking-wide\">${p.name}</span>${statusHtml[p.status](p.name)}</div></div>`).join('')}
        </div>
      </div>
      <style>
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
    </div>
  </div>
  `;
}

export default async function handler(req, res) {
    const { tmdb, api, title, s, e } = req.query;

    // Bridge: allow sniffStreamUrl to update popup in HTML response
    globalThis.res = {
        __providerPopupUpdate: async (idx, status) => {
            if (res.flush) {
                res.write(`<script>window.__providerPopupUpdate(${idx},'${status}');</script>\n`);
                await new Promise(r => setTimeout(r, 10));
            }
        },
        __providerPopupHide: async () => {
            if (res.flush) {
                res.write(`<script>window.__providerPopupHide();</script>\n`);
                await new Promise(r => setTimeout(r, 10));
            }
        }
    };

    // Serve the HTML page
    const serveHtmlPage = async (streamUrl = null, pageTitle = null, sniffProgress = null) => {
        const htmlPath = path.join(process.cwd(), 'public', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf8');
        // Providers for popup
        const popupProviders = [
          { name: "Vidsrc", status: "pending" },
          { name: "AutoEmbed", status: "pending" },
          { name: "UEmbed", status: "pending" },
          { name: "P-Stream", status: "pending" },
        ];
        if (sniffProgress) {
          sniffProgress.forEach((s, i) => popupProviders[i].status = s);
        }
        // Inject popup
        const popupHtml = getProviderPopupHtml(popupProviders);
        html = html.replace('<body>', `<body>\n${popupHtml}`);
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
        // Add script to update popup as sniffing progresses
        html = html.replace('</body>', `<script id=\"provider-popup-script\">
        window.__providerPopupUpdate = function(idx, status) {
          var popup = document.getElementById('provider-popup-overlay');
          if (!popup) return;
          var items = popup.querySelectorAll('.space-y-px > div');
          if (items[idx]) {
            var statusDiv = items[idx].querySelector('div.flex.items-center.gap-2');
            if (statusDiv) statusDiv.outerHTML = {
              pending: '${statusHtml.pending('')}',
              loading: '${statusHtml.loading('')}',
              completed: '${statusHtml.completed('')}',
              error: '${statusHtml.error('')}'
            }[status];
          }
          // Update progress count
          var countDiv = popup.querySelector('div.rounded-full.bg-\[\#0099ff\]\/10');
          if (countDiv) {
            var completed = Array.from(items).filter(x => x.innerHTML.includes('Complete')).length;
            countDiv.innerHTML = completed + ' / 4';
          }
        };
        window.__providerPopupHide = function() {
          var popup = document.getElementById('provider-popup-overlay');
          if (popup) popup.style.display = 'none';
        };
        </script>\n</body>`);
        res.setHeader('content-type', 'text/html');
        res.send(html);
    };

    if (!tmdb) {
        return serveHtmlPage();
    }

    if (!tmdb) return res.status(400).send('Missing tmdb param');
    const browserlessToken = api || process.env.BROWSERLESS_TOKEN;
    // Parse season and episode, default to 1 if not provided
    const season = s ? parseInt(s, 10) : 1;
    const episode = e ? parseInt(e, 10) : 1;
    let streamUrl;
    try {
        streamUrl = await sniffStreamUrl(tmdb, season, episode, browserlessToken);
    } catch (e) {
        return res.status(500).send('Stream sniffing failed: ' + e.message);
    }
    if (!streamUrl) return res.status(404).send('No stream found');
    serveHtmlPage(streamUrl, title);
}
