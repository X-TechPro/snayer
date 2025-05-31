# Vercel Video Stream Proxy

This project provides a Vercel-compatible API for streaming videos by direct URL, IMDB movie, or TV episode. It serves a modern HTML5 video player, with the video source and optional title injected dynamically.

## API Endpoints

### 1. `/api/stream?url=VIDEO_URL&title=OPTIONAL_TITLE`
- **url**: Direct video URL (must start with `http`).
- **title**: (optional) Title to display in the player UI.
- Returns an HTML page with a video player streaming the provided video URL.

### 2. `/api/movie?imdb=IMDB_ID&title=OPTIONAL_TITLE&api=BROWSERLESS_TOKEN`
- **imdb**: IMDB ID of the movie (e.g. `tt1234567`).
- **title**: (optional) Title to display in the player UI.
- **api**: (optional) [browserless.io](https://www.browserless.io/) token. If not provided, uses `BROWSERLESS_TOKEN` env variable.
- Returns an HTML page with a video player streaming the discovered movie source.

### 3. `/api/tv?imdb=IMDB_ID&s=SEASON&e=EPISODE&title=OPTIONAL_TITLE&api=BROWSERLESS_TOKEN`
- **imdb**: IMDB ID of the TV show (e.g. `tt1234567`).
- **s**: Season number (default: 1).
- **e**: Episode number (default: 1).
- **title**: (optional) Title to display in the player UI.
- **api**: (optional) [browserless.io](https://www.browserless.io/) token. If not provided, uses `BROWSERLESS_TOKEN` env variable.
- Returns an HTML page with a video player streaming the discovered episode source.

## Project Structure

- `/pages/api/stream.js` — Streams a direct video URL in the player
- `/pages/api/movie.js` — Streams a movie by IMDB ID (uses browserless.io to sniff sources)
- `/pages/api/tv.js` — Streams a TV episode by IMDB ID, season, and episode (uses browserless.io)
- `/public/index.html` — Template for the video player UI
- `/pages/index.js` — Returns a simple "API Only" message

## Deployment

1. Deploy to Vercel.
2. Access the endpoints as described above.

---

**Note:** This project is for educational/demo purposes. Only use direct video URLs you have the right to stream. Respect copyright and terms of service of all providers.
