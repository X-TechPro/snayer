// Next.js API route for /api/madplay
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

// CORS middleware wrapper for Next.js API
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

// Next.js API route handler
export default async function mainHandler(req, res) {
  await runMiddleware(req, res, corsMiddleware);

  const { tmdb, title, s, e } = req.query;
  if (!tmdb) return res.status(400).json({ error: 'Missing tmdb param' });

  // Step 1: Fetch madplay playsrc (support season/episode)
  let playsrc;
  try {
      let playsrcUrl = `https://madplay.site/api/playsrc?id=${encodeURIComponent(tmdb)}`;
      if (s && e) {
        playsrcUrl += `&season=${encodeURIComponent(s)}&episode=${encodeURIComponent(e)}`;
      }
      const srcRes = await axios.get(playsrcUrl);
      const srcJson = srcRes.data;
      if (!Array.isArray(srcJson) || !srcJson[0]?.file) throw new Error('No file in madplay response');
      playsrc = srcJson[0].file;
  } catch (e) {
      return res.status(502).json({ error: 'Failed to fetch madplay playsrc', detail: e.message });
  }

  // Step 2: Fetch master.m3u8 and pick best resolution
  let bestStreamUrl = null;
  try {
      const m3u8Res = await axios.get(playsrc);
      const m3u8 = m3u8Res.data;
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

  // Step 3: Fetch subtitles if tmdb param is present
  let subtitles = [];
  if (tmdb) {
    try {
      const subRes = await axios.get(`https://madplay.site/api/subtitle?id=${encodeURIComponent(tmdb)}`);
      if (subRes.status === 200) {
        subtitles = subRes.data;
      }
    } catch (e) {
      // ignore subtitle errors
    }
  }

  // Step 4: Serve index.html with injected stream URL, title, and subtitles
  const htmlPath = path.join(process.cwd(), 'public', 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  // Inject the video source as window.source
  html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.source = '/api/madplay/proxy?url=' + encodeURIComponent('${bestStreamUrl}');<\/script>`);
  // Inject the title as window.__PLAYER_TITLE__
  if (title) {
    html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__PLAYER_TITLE__ = ${JSON.stringify(title)};<\/script>`);
  }
  // Inject subtitles as window.__SUBTITLES__
  if (subtitles && subtitles.length) {
    html = html.replace('<script src="https://unpkg.com/lucide@latest"></script>', `<script src="https://unpkg.com/lucide@latest"></script>\n<script>window.__SUBTITLES__ = ${JSON.stringify(subtitles)};<\/script>`);
  }
  res.setHeader('content-type', 'text/html');
  res.send(html);
}
