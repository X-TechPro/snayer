import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import cors from 'cors';

// Configure CORS
const corsMiddleware = cors({
    origin: '*',
    methods: ['GET'],
    allowedHeaders: ['Content-Type']
});

export default async function handler(req, res) {
    return corsMiddleware(req, res, async () => {
        const { url, title, tmdb, proxy } = req.query;

        // Handle proxy requests
        if (proxy) {
            try {
                // Preserve all query parameters from original URL
                const fullUrl = new URL(decodeURIComponent(proxy));
                
                // Reconstruct URL with all original query parameters
                const reconstructedUrl = fullUrl.origin + fullUrl.pathname + fullUrl.search;
                
                const proxyResponse = await fetch(reconstructedUrl);
                if (!proxyResponse.ok) {
                    return res.status(proxyResponse.status).send('Upstream server error');
                }

                const m3u8Content = await proxyResponse.text();
                const basePath = getBasePath(reconstructedUrl);
                const rewrittenContent = rewriteM3U8(m3u8Content, basePath);

                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                return res.send(rewrittenContent);
            } catch (error) {
                console.error('Proxy error:', error);
                return res.status(500).send('Internal server error');
            }
        }

        // Handle player page requests
        try {
            const htmlPath = path.join(process.cwd(), 'public', 'index.html');
            let html = fs.readFileSync(htmlPath, 'utf8');
            const injectionScripts = [];

            if (url) {
                const decodedUrl = decodeURIComponent(url);
                injectionScripts.push(`window.source = ${JSON.stringify(decodedUrl)};`);
            }

            if (title) {
                injectionScripts.push(`window.__PLAYER_TITLE__ = ${JSON.stringify(title)};`);
            }

            if (tmdb) {
                try {
                    const subResponse = await fetch(`https://madplay.site/api/subtitle?id=${tmdb}`);
                    if (subResponse.ok) {
                        const subtitles = await subResponse.json();
                        injectionScripts.push(`window.__SUBTITLES__ = ${JSON.stringify(subtitles)};`);
                    }
                } catch (e) {
                    console.error('Subtitle fetch error:', e);
                }
            }

            if (injectionScripts.length > 0) {
                const injectionPoint = '<script src="https://unpkg.com/lucide@latest"></script>';
                html = html.replace(
                    injectionPoint, 
                    `${injectionPoint}\n<script>${injectionScripts.join('\n')}</script>`
                );
            }

            res.setHeader('Content-Type', 'text/html');
            return res.send(html);
        } catch (error) {
            console.error('HTML processing error:', error);
            return res.status(500).send('Internal server error');
        }
    });
}

// Helper functions
function getBasePath(fullUrl) {
    const urlObj = new URL(fullUrl);
    return `${urlObj.origin}${urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1)}`;
}

function rewriteM3U8(content, basePath) {
    return content
        .split('\n')
        .map(line => {
            if (line.startsWith('#') || line.trim() === '') return line;
            return line.startsWith('http') ? line : `${basePath}${line}`;
        })
        .join('\n');
}