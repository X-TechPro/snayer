import { sniffStreamUrl } from './movie';

export default async function handler(req, res) {
    const { tmdb, api } = req.query;
    
    if (!tmdb) {
        return res.status(400).json({ error: 'Missing tmdb parameter' });
    }
    
    const browserlessToken = api || process.env.BROWSERLESS_TOKEN;
    
    try {
        const streamUrl = await sniffStreamUrl(tmdb, browserlessToken);
        if (!streamUrl) {
            return res.status(404).json({ error: 'No stream found' });
        }
        return res.json({ streamUrl });
    } catch (error) {
        console.error('Sniffing error:', error);
        return res.status(500).json({ 
            error: 'Stream sniffing failed',
            message: error.message 
        });
    }
}
