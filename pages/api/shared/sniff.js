// Stream sniffing utilities for /api endpoints
import puppeteer from 'puppeteer-core';

export function getProviders(type, tmdb_id, season = 1, episode = 1) {
    if (type === 'tv') {
        return [
            { name: 'VidEasy', url: `https://player.videasy.net/tv/${tmdb_id}/${season}/${episode}` },
            { name: 'VidPro', url: `https://player.vidpro.top/embed/tv/${tmdb_id}/${season}/${episode}` },
            { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/tv/${tmdb_id}/${season}/${episode}` },
            { name: 'UEmbed', url: `https://uembed.site/?id=${tmdb_id}&season=${season}&episode=${episode}` },
            { name: 'P-Stream', url: `https://iframe.pstream.org/embed/tmdb-tv-${tmdb_id}/${season}/${episode}` },
        ];
    }
    // Default to movie
    return [
        { name: 'VidEasy', url: `https://player.videasy.net/movie/${tmdb_id}` },
        { name: 'VidPro', url: `https://player.vidpro.top/embed/movie/${tmdb_id}` },
        { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/movie/${tmdb_id}` },
        { name: 'UEmbed', url: `https://uembed.site/?id=${tmdb_id}` },
        { name: 'P-Stream', url: `https://iframe.pstream.org/embed/tmdb-movie-${tmdb_id}` },
    ];
}

export async function sniffStreamUrl(type, tmdb_id, browserlessToken, onStatus, season = 1, episode = 1) {
    if (!browserlessToken) {
        throw new Error('Missing BROWSERLESS_TOKEN environment variable or api param.');
    }
    const browserWSEndpoint = `wss://production-lon.browserless.io?token=${browserlessToken}`;
    const providers = getProviders(type, tmdb_id, season, episode);
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
            // Special handling for VidEasy: wait 1s then click the lone button (often inside a div)
            if (provider.name === 'VidEasy' || provider.url.includes('videasy.net')) {
                try {
                    await page.waitForTimeout(1000);
                    // Try to click the first <button> if present
                    const btn = await page.$('button');
                    if (btn) {
                        await btn.click({ delay: 50 });
                    } else {
                        // Fallback: click a clickable div or the first element that looks like a play wrapper
                        await page.evaluate(() => {
                            const el = document.querySelector('div[role="button"]') || document.querySelector('div');
                            if (el && typeof el.click === 'function') el.click();
                        });
                    }
                    // allow time for the player to request manifests after the click
                    await page.waitForTimeout(2000);
                } catch (e) {
                    // non-fatal; continue sniffing
                }
            } else {
                await new Promise(r => setTimeout(r, 3000));
            }
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
