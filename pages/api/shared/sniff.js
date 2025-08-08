// Stream sniffing utilities for /api endpoints
import puppeteer from 'puppeteer-core';

export function getProviders(type, tmdb_id, season = 1, episode = 1) {
    if (type === 'tv') {
        return [
            { name: 'VidFast.pro', url: `https://vidfast.pro/tv/${tmdb_id}/${season}/${episode}?autoPlay=true&server=Alpha` },
            { name: 'Vidsrc', url: `https://player.vidsrc.co/embed/tv/${tmdb_id}/${season}/${episode}` },
            { name: 'Vidsrc.vip', url: `https://vidsrc.vip/embed/movie/${tmdb_id}` },
            { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/tv/${tmdb_id}/${season}/${episode}` },
            { name: 'UEmbed', url: `https://uembed.site/?id=${tmdb_id}&season=${season}&episode=${episode}` },
            { name: 'P-Stream', url: `https://iframe.pstream.org/embed/tmdb-tv-${tmdb_id}/${season}/${episode}` },
        ];
    }
    // Default to movie
    return [
        { name: 'VidFast.pro', url: `https://vidfast.pro/movie/${tmdb_id}?autoPlay=true&server=Alpha` },
        { name: 'Vidsrc', url: `https://player.vidsrc.co/embed/movie/${tmdb_id}` },
        { name: 'Vidsrc.vip', url: `https://vidsrc.vip/embed/movie/${tmdb_id}` },
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
                } else if (provider.name === 'VidFast.pro' || req.url().includes('vidfast.pro')) {
                    const headers = Object.assign({}, req.headers(), {
                        'Origin': 'https://vidfast.pro',
                        'Referer': 'https://vidfast.pro/'
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
            if (provider.name === 'VidFast.pro') {
                // Prefer 1080p link (contains /MTA4MA==/)
                const mp4_1080 = mp4Info.find(x => x.url.includes('/MTA4MA==/'));
                if (mp4_1080) {
                    finalUrl = mp4_1080.url;
                } else if (mp4Info.length) {
                    finalUrl = mp4Info[mp4Info.length - 1].url;
                }
            } else if (mp4Info.length) {
                finalUrl = mp4Info.sort((a, b) => (b.size - a.size) || (b.url.length - a.url.length))[0]?.url;
            } else if (m3u8Info.length) {
                finalUrl = m3u8Info.sort((a, b) => b.time - a.time)[0]?.url;
            }
            await browser.close();
        } catch (e) {
            // ignore error, mark as error
        }
        if (finalUrl) {
            // Proxy the stream for VidFast.pro with correct headers
            let proxiedUrl = finalUrl;
            if (provider.name === 'VidFast.pro') {
                proxiedUrl = `/api/proxy?url=${encodeURIComponent(finalUrl)}`;
            }
            if (onStatus) onStatus(i, 'completed', proxiedUrl);
            return proxiedUrl;
        } else {
            if (onStatus) onStatus(i, 'error');
        }
    }
    return null;
}
