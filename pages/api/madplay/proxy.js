import axios from 'axios';
import cors from 'cors';

const corsMiddleware = cors({
  origin: '*',
  methods: ['GET', 'HEAD'],
  allowedHeaders: ['*'],
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) {
        return reject(result);
      }
      return resolve(result);
    });
  });
}

export default async function handler(req, res) {
  await runMiddleware(req, res, corsMiddleware);
  const { url } = req.query;
  if (!url || !url.startsWith('http')) return res.status(400).send('Invalid url');
  try {
    const streamRes = await axios.get(url, {
      headers: { origin: 'https://madplay.site' },
      responseType: 'stream',
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('content-type', streamRes.headers['content-type'] || 'application/octet-stream');
    streamRes.data.pipe(res);
  } catch (e) {
    res.status(502).send('Proxy error: ' + e.message);
  }
}
