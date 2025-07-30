// Refactored madplay proxy API using centralized proxy utility
const { proxyStream } = require('../../../lib/proxy');

export default async function handler(req, res) {
  const { url } = req.query;
  if (!url || !url.startsWith('http')) return res.status(400).send('Invalid url');
  const headers = { origin: 'https://madplay.site' };
  if (req.headers['range']) {
    headers['range'] = req.headers['range'];
  }
  return proxyStream({ req, res, url, headers });
}
