import axios from 'axios';
import { corsMiddleware, runMiddleware } from '../shared/utils';


export default async function handler(req, res) {
  await runMiddleware(req, res, corsMiddleware);
  const { url } = req.query;
  if (!url || !url.startsWith('http')) return res.status(400).send('Invalid url');
  try {
    // Forward range header for seeking support
    const headers = { origin: 'https://madplay.site' };
    if (req.headers['range']) {
      headers['range'] = req.headers['range'];
    }
    const streamRes = await axios.get(url, {
      headers,
      responseType: 'stream',
      validateStatus: status => status < 500 // allow 206, 416, etc
    });

    // Forward status code (e.g., 206 Partial Content)
    res.status(streamRes.status);

    // Forward important headers
    const headerWhitelist = [
      'content-type',
      'content-length',
      'accept-ranges',
      'content-range',
      'cache-control',
      'expires',
      'last-modified',
      'pragma',
      'transfer-encoding'
    ];
    for (const key of headerWhitelist) {
      if (streamRes.headers[key]) {
        res.setHeader(key, streamRes.headers[key]);
      }
    }
    // Always allow CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    // If no content-length, force chunked encoding
    if (!streamRes.headers['content-length']) {
      res.setHeader('Transfer-Encoding', 'chunked');
    }
    streamRes.data.pipe(res);
  } catch (e) {
    // If axios error has a response, forward status and headers
    if (e.response) {
      res.status(e.response.status);
      for (const key in e.response.headers) {
        res.setHeader(key, e.response.headers[key]);
      }
      if (e.response.data && e.response.data.pipe) {
        e.response.data.pipe(res);
        return;
      }
    }
    res.status(502).send('Proxy error: ' + e.message);
  }
}
