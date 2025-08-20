// Stream sniffing utilities for /api endpoints
import puppeteer from 'puppeteer-core';

// Hardcoded free TMDB API key (per request)
const TMDB_API_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI2ZWFjNjM1ODA4YmRjMDJkZjI2ZDMwMjk0MGI0Y2EzNyIsIm5iZiI6MTc0ODY4NTIxNy43Mjg5OTk5LCJzdWIiOiI2ODNhZDFhMTkyMWI4N2IxYzk1Mzc4ODQiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.w-oWdRIxwlXKTpP42Yo87Mld5sqp8uNFpDHgrqB6a3U';

// Fetch TMDB details for movie or tv and return title, year and runtime
async function fetchTmdbDetails(type, tmdb_id) {
    try {
        const base = 'https://api.themoviedb.org/3';
        const url = type === 'tv' ? `${base}/tv/${tmdb_id}?language=en-US&api_key=${TMDB_API_KEY}` : `${base}/movie/${tmdb_id}?language=en-US&api_key=${TMDB_API_KEY}`;
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (!res.ok) return null;
        const obj = await res.json();
        if (!obj) return null;

        let title = '';
        let date = '';
        let runtime = '';
        if (type === 'tv') {
            title = obj.name || obj.original_name || '';
            date = obj.first_air_date || obj.last_air_date || '';
            // tv runtime is an array of episode runtimes; take first if available
            if (Array.isArray(obj.episode_run_time) && obj.episode_run_time.length) {
                runtime = String(obj.episode_run_time[0]);
            }
        } else {
            title = obj.title || obj.original_title || '';
            date = obj.release_date || '';
            if (typeof obj.runtime === 'number') runtime = String(obj.runtime);
        }

        const year = date ? (date.split('-')[0] || '') : '';
        // sanitize title for URL (basic)
        const safeTitle = encodeURIComponent((title || '').replace(/\s+/g, ' ').trim());
        return { title: safeTitle, year, runtime };
    } catch (e) {
        return null;
    }
}

export async function getProviders(type, tmdb_id, season = 1, episode = 1) {
    const details = await fetchTmdbDetails(type, tmdb_id);
    const title = details?.title || '';
    const year = details?.year || '';
    const runtime = details?.runtime || '';

    if (type === 'tv') {
        return [
            { name: 'ShowBox', url: `https://showbox-five.vercel.app/api/scrape?title=${title}&year=${year}&rt=${runtime}&type=2` },
            { name: 'VidEasy', url: `https://player.videasy.net/tv/${tmdb_id}/${season}/${episode}` },
            { name: 'VidPro', url: `https://player.vidpro.top/embed/tv/${tmdb_id}/${season}/${episode}` },
            { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/tv/${tmdb_id}/${season}/${episode}` },
            { name: 'UEmbed', url: `https://uembed.site/?id=${tmdb_id}&season=${season}&episode=${episode}` },
            { name: 'P-Stream', url: `https://iframe.pstream.org/embed/tmdb-tv-${tmdb_id}/${season}/${episode}` },
        ];
    }
    // Default to movie
    return [
        { name: 'ShowBox', url: `https://showbox-five.vercel.app/api/scrape?title=${title}&year=${year}&rt=${runtime}&type=1` },
        { name: 'VidPro', url: `https://player.vidpro.top/embed/movie/${tmdb_id}` },
        { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/movie/${tmdb_id}` },
        { name: 'VidEasy', url: `https://player.videasy.net/movie/${tmdb_id}` },
        { name: 'UEmbed', url: `https://uembed.site/?id=${tmdb_id}` },
        { name: 'P-Stream', url: `https://iframe.pstream.org/embed/tmdb-movie-${tmdb_id}` },
    ];
}

export async function sniffStreamUrl(type, tmdb_id, browserlessToken, onStatus, season = 1, episode = 1) {
    if (!browserlessToken) {
        throw new Error('Missing BROWSERLESS_TOKEN environment variable or api param.');
    }
    const browserWSEndpoint = `wss://production-lon.browserless.io?token=${browserlessToken}`;
    const providers = await getProviders(type, tmdb_id, season, episode);
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
