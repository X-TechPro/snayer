// Proxy utilities for /api endpoints
import fetch from 'node-fetch';
import { Readable } from 'stream';

export async function proxyStream(req, res, url, headers = {}, extraOptions = {}) {
    const response = await fetch(url, { headers, ...extraOptions });
    res.status(response.status);
    for (const [key, value] of response.headers.entries()) {
        res.setHeader(key, value);
    }
    const readable = Readable.from(response.body);
    readable.pipe(res);
}

export function getProxyHeaders(type, req, url = '') {
    if (type === 'mbox') {
        const headers = {
            'Origin': 'https://moviebox.ng',
            'Referer': 'https://moviebox.ng',
            // prefer the incoming user-agent but fall back to a generic one
            'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': '*/*',
            // avoid compressed responses so we can stream bytes directly
            'Accept-Encoding': 'identity',
            ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {}),
        };

        // site-specific overrides
        if (url && url.includes('madplay.site')) {
            headers['Origin'] = 'https://uembed.site';
            headers['Referer'] = 'https://uembed.site';
        }
        if (url && url.includes('shegu.net')) {
            // shegu appears to block some browser clients — try a player-like UA and set referer/origin
            headers['Origin'] = 'https://shegu.net';
            headers['Referer'] = 'https://shegu.net';
            headers['User-Agent'] = 'VLC/3.0.16 LibVLC/3.0.16';
        }

        return headers;
    }
    return {};
}
