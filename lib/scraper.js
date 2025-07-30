// Puppeteer scraping utility
const puppeteer = require('puppeteer-core');
const { getMovieProviders, getTvProviders } = require('./providers');

async function sniffStreamUrl({ tmdb, token, type = 'movie', season = 1, episode = 1, onStatus }) {
    if (!token) throw new Error('Missing browserless token');
    const browserWSEndpoint = `wss://production-lon.browserless.io?token=${token}`;
    const providers = type === 'tv' ? getTvProviders(tmdb, season, episode) : getMovieProviders(tmdb);
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
                if (url.includes('.mp4')) mp4Info.push({ url, size: len });
                if (url.includes('.m3u8')) m3u8Info.push({ url, time: Date.now() });
            });
            await page.goto(provider.url, { waitUntil: 'networkidle2', timeout: 60000 });
            await new Promise(r => setTimeout(r, 3000));
            if (mp4Info.length) {
                finalUrl = mp4Info.sort((a, b) => (b.size - a.size) || (b.url.length - a.url.length))[0]?.url;
            } else if (m3u8Info.length) {
                finalUrl = m3u8Info.sort((a, b) => b.time - a.time)[0]?.url;
            }
            await browser.close();
        } catch (e) {}
        if (finalUrl) {
            if (onStatus) onStatus(i, 'completed', finalUrl);
            return finalUrl;
        } else {
            if (onStatus) onStatus(i, 'error');
        }
    }
    return null;
}

module.exports = { sniffStreamUrl };
