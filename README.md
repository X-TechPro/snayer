# Snayer Video Stream Proxy

This project provides a Vercel-compatible API for streaming movies and TV episodes by direct URL, TMDB movie, or TV episode. It serves a modern HTML5 video player, with the video source, title, and subtitles injected dynamically. The UI includes a beautiful popup for scraping providers and real-time progress updates.

## API Endpoints

### 1. `/api/stream?url=VIDEO_URL&title=OPTIONAL_TITLE&tmdb=TMDB_ID&s=SEASON&e=EPISODE`
- **url**: Direct video URL (must start with `http`).
- **title**: (optional) Title to display in the player UI.
- **tmdb**: (optional) TMDB ID for fetching subtitles.
- **s**: (optional) Season number (for TV episodes, used for subtitles).
- **e**: (optional) Episode number (for TV episodes, used for subtitles).
- Returns an HTML page with a video player streaming the provided video URL and loading subtitles if available.

### 2. `/api/movie?tmdb=TMDB_ID&title=OPTIONAL_TITLE&api=BROWSERLESS_TOKEN`
- **tmdb**: TMDB ID of the movie (e.g. `920`).
- **title**: (optional) Title to display in the player UI.
- **api**: [browserless.io](https://www.browserless.io/) token.
- Returns a popup UI that scrapes providers, shows progress, and automatically redirects to `/api/stream` with the discovered movie source and subtitles.

### 3. `/api/tv?tmdb=TMDB_ID&s=SEASON&e=EPISODE&title=OPTIONAL_TITLE&api=BROWSERLESS_TOKEN`
- **tmdb**: TMDB ID of the TV show (e.g. `920`).
- **s**: Season number (default: 1).
- **e**: Episode number (default: 1).
- **title**: (optional) Title to display in the player UI.
- **api**: [browserless.io](https://www.browserless.io/) token.
- Returns a popup UI that scrapes providers, shows progress, and automatically redirects to `/api/stream` with the discovered episode source and subtitles.

## Features
- **Modern UI**: Beautiful popup with Tailwind CSS, progress indicators, and provider status.
- **Automatic Scraping**: Uses browserless.io and Puppeteer to sniff for direct video sources from multiple providers.
- **Subtitles**: Automatically fetches and injects subtitles from madplay.site for both movies and TV episodes.
- **Seamless Playback**: Redirects to a player page as soon as a stream is found.

## Project Structure
- `/pages/api/stream.js` — Streams a direct video URL in the player, injects title and subtitles.
- `/pages/api/movie.js` — Streams a movie by TMDB ID (uses browserless.io to sniff sources, serves popup UI).
- `/pages/api/tv.js` — Streams a TV episode by TMDB ID, season, and episode (uses browserless.io, serves popup UI).
- `/public/index.html` — Template for the video player UI.
- `/public/popup.html` — Beautiful popup UI for scraping providers and showing progress.
- `/pages/index.js` — Returns a simple "API Only" message.

## Deployment
1. Deploy to Vercel or your preferred Node.js hosting.
2. Access the endpoints as described above.

---

**Note:** This project is for educational/demo purposes. Only use direct video URLs you have the right to stream. Respect copyright and terms of service of all providers.
