// Next.js API route for /api/madplay
// Refactored madplay API using centralized utilities
const axios = require('axios');
const { fetchSubtitles } = require('../../lib/subtitles');
const { readHtml, injectHtml } = require('../../lib/html');

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default async function mainHandler(req, res) {
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
  let subtitles = await fetchSubtitles(tmdb);

  // Step 4: Serve index.html with injected stream URL, title, and subtitles
  let html = readHtml('index.html');
  html = injectHtml(html, {
    source: `/api/madplay/proxy?url=${encodeURIComponent(bestStreamUrl)}`,
    title,
    subtitles
  });
  res.setHeader('content-type', 'text/html');
  res.send(html);
}
