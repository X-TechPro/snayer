// Next.js API route for /api/proxy
// Refactored proxy API using centralized proxy utility
const { proxyStream } = require('../../lib/proxy');

export default async function handler(req, res) {
    const url = req.query.url ? decodeURIComponent(req.query.url) : undefined;
    if (!url || !url.startsWith('http')) {
        return res.status(400).send('Invalid URL');
    }
    const headers = {};
    if (req.headers['range']) {
        headers['range'] = req.headers['range'];
    }
    return proxyStream({ req, res, url, headers, rewriteM3U8: true });
}
