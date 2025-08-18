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
}
