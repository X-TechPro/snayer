// Next.js API route for /api/madplay
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

// Next.js custom route handler for /api/madplay/proxy
export async function handlerProxy(req, res) {
  const { url } = req.query;
  if (!url || !url.startsWith('http')) return res.status(400).send('Invalid url');
  try {
    const streamRes = await fetch(url, { headers: { 'origin': 'https://madplay.site' } });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('content-type', streamRes.headers.get('content-type') || 'application/octet-stream');
    streamRes.body.pipe(res);
  } catch (e) {
    res.status(502).send('Proxy error: ' + e.message);
  }
}

// Next.js API route handler
export default async function mainHandler(req, res) {
  if (req.url.startsWith('/api/madplay/proxy')) {
    return handlerProxy(req, res);
  }

  const { tmdb } = req.query;
  if (!tmdb) return res.status(400).json({ error: 'Missing tmdb param' });

  // Step 1: Fetch madplay playsrc
  let playsrc;
  try {
      const srcRes = await fetch(`https://madplay.site/api/playsrc?id=${encodeURIComponent(tmdb)}`);
      if (!srcRes.ok) throw new Error('madplay.site/api/playsrc failed');
      const srcJson = await srcRes.json();
      if (!Array.isArray(srcJson) || !srcJson[0]?.file) throw new Error('No file in madplay response');
      playsrc = srcJson[0].file;
  } catch (e) {
      return res.status(502).json({ error: 'Failed to fetch madplay playsrc', detail: e.message });
  }

  // Step 2: Fetch master.m3u8 and pick best resolution
  let bestStreamUrl = null;
  try {
      const m3u8Res = await fetch(playsrc);
      if (!m3u8Res.ok) throw new Error('Failed to fetch master.m3u8');
      const m3u8 = await m3u8Res.text();
      // Parse m3u8 for all #EXT-X-STREAM-INF and their URLs
      const lines = m3u8.split('\n');
      let bestRes = 0;
      let bestUrl = null;
      for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
              const resMatch = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
              const url = lines[i + 1]?.trim();
              if (resMatch && url && url.startsWith('http')) {
                  const res = parseInt(resMatch[1], 10) * parseInt(resMatch[2], 10);
                  if (res > bestRes) {
                      bestRes = res;
                      bestUrl = url;
                  }
              }
          }
      }
      if (!bestUrl) throw new Error('No stream found in m3u8');
      bestStreamUrl = bestUrl;
  } catch (e) {
      return res.status(502).json({ error: 'Failed to parse m3u8', detail: e.message });
  }

  // Step 3: Serve index.html with injected stream URL (CORS proxy)
  const htmlPath = path.join(process.cwd(), 'public', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  // Inject the video source as window.source
  html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = '/api/madplay/proxy?url=' + encodeURIComponent('${bestStreamUrl}');</script>`);
  res.setHeader('content-type', 'text/html');
  res.send(html);
}
