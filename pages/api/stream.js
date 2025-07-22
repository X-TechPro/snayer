// pages/api/stream.js

import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import Cors from 'cors';

// Initialize CORS middleware
const cors = Cors({
  origin: '*',
  methods: ['GET'],
  allowedHeaders: ['Content-Type'],
});

// Utility to run middleware
function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export default async function handler(req, res) {
  // Run CORS
  await runMiddleware(req, res, cors);

  const { proxy: proxyEncoded } = req.query;

  if (proxyEncoded) {
    try {
      // Decode the full URL including query string
      const decoded = decodeURIComponent(proxyEncoded);
      const upstreamUrl = new URL(decoded);

      // Fetch via Node with minimal headers (mimic curl/VLC)
      const upstreamRes = await fetch(upstreamUrl.toString(), {
        headers: {
          'User-Agent': 'curl/7.64.1',
          'Accept': '*/*',
          'Range': 'bytes=0-',
        },
      });

      if (!upstreamRes.ok) {
        return res.status(upstreamRes.status).send(`Upstream error: ${upstreamRes.statusText}`);
      }

      // Rewrite relative segment URLs if needed
      const text = await upstreamRes.text();
      const base = upstreamUrl.origin + upstreamUrl.pathname.replace(/\/[^/]*$/, '/') ;
      const m3u8 = text
        .split('\n')
        .map(line => {
          if (/^https?:\/\//.test(line) || line.startsWith('#') || !line.trim()) {
            return line;
          }
          return base + line;
        })
        .join('\n');

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(m3u8);
    } catch (err) {
      console.error(err);
      return res.status(500).send('Failed to proxy M3U8');
    }
  }

  // Fallback: serve HTML player
  const htmlPath = path.join(process.cwd(), 'public', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  res.setHeader('Content-Type', 'text/html');
  return res.send(html);
}
