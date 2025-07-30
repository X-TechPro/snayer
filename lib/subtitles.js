// Subtitle fetching utility
const axios = require('axios');

async function fetchSubtitles(tmdb) {
    if (!tmdb) return [];
    try {
        const subRes = await axios.get(`https://madplay.site/api/subtitle?id=${encodeURIComponent(tmdb)}`);
        if (subRes.status === 200) {
            return subRes.data;
        }
    } catch (e) {
        // ignore subtitle errors
    }
    return [];
}

module.exports = { fetchSubtitles };
