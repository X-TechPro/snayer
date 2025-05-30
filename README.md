# Vercel IMDb Stream Proxy

This project provides a Vercel-compatible API for streaming movies by IMDb ID. It uses headless browser automation to sniff direct video stream URLs from popular embed providers, and serves a modern HTML5 video player.

## Usage

- **API Endpoint:** `/api/stream?imdb=ttxxxx&api=YOUR_BROWSERLESS_TOKEN`
  - `imdb`: IMDb ID of the movie (e.g. `tt3606752`)
  - `api`: (optional) Browserless API key. If omitted, the `BROWSERLESS_TOKEN` environment variable is used.
- The endpoint returns an HTML page with a video player streaming the movie.
- The player proxies video requests through the same endpoint for CORS and range support.

## Project Structure

- `/api/stream.js` — Main Vercel API handler (all logic here)
- `/public/index.html` — Used as a template for the video player UI (injected dynamically)
- `/archive/` — Contains files not used by the Vercel deployment (legacy or local dev only)

## Deployment

1. Set your `BROWSERLESS_TOKEN` in Vercel project environment variables (or use the `api` param per request).
2. Deploy to Vercel.
3. Access: `https://your-vercel-app.vercel.app/stream?imdb=ttxxxx&api=YOUR_BROWSERLESS_TOKEN`

---

**Note:** This project is for educational/demo purposes. Respect copyright and terms of service of all providers.
