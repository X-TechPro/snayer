// Returns VLC-like headers for proxying VidFast streams
export function getVlcHeaders(req) {
    return {
        'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20',
        'Accept': '*/*',
        'Connection': 'keep-alive',
        'Icy-MetaData': '1',
        ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
    };
}
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

export function getProxyHeaders(type, req) {
    if (type === 'mbox') {
        return {
            'Origin': 'https://moviebox.ng',
            'Referer': 'https://moviebox.ng',
            ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
        };
    }
    // Default to vidsrc.vip
    return {
        'Origin': 'https://vidsrc.vip',
        'Referer': 'https://vidsrc.vip/',
        ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {})
    };
}
