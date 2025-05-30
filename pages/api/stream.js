// Next.js API route for /api/stream

import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
    const { url, title } = req.query;

    // If url is provided, return it as JSON for the video player
    if (url) {
        if (!url.startsWith('http')) {
            return res.status(400).json({ error: 'Invalid URL' });
        }
        return res.json({ source: url, title: title || null });
    }

    // Serve the HTML page if no url param
    const htmlPath = path.join(process.cwd(), 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    res.setHeader('content-type', 'text/html');
    res.send(html);
}
