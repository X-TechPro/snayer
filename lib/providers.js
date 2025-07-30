// Centralized provider lists for movies and TV

function getMovieProviders(tmdb_id) {
    return [
        { name: 'Vidsrc', url: `https://player.vidsrc.co/embed/movie/${tmdb_id}` },
        { name: 'Vidsrc.vip', url: `https://vidsrc.vip/embed/movie/${tmdb_id}` },
        { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/movie/${tmdb_id}` },
        { name: 'UEmbed', url: `https://uembed.site/?id=${tmdb_id}` },
        { name: 'P-Stream', url: `https://iframe.pstream.org/embed/tmdb-movie-${tmdb_id}` },
    ];
}

function getTvProviders(tmdb_id, season = 1, episode = 1) {
    return [
        { name: 'Vidsrc', url: `https://player.vidsrc.co/embed/tv/${tmdb_id}/${season}/${episode}` },
        { name: 'Vidsrc.vip', url: `https://vidsrc.vip/embed/movie/${tmdb_id}` },
        { name: 'AutoEmbed', url: `https://player.autoembed.cc/embed/tv/${tmdb_id}/${season}/${episode}` },
        { name: 'UEmbed', url: `https://uembed.site/?id=${tmdb_id}&season=${season}&episode=${episode}` },
        { name: 'P-Stream', url: `https://iframe.pstream.org/embed/tmdb-tv-${tmdb_id}/${season}/${episode}` },
    ];
}

module.exports = { getMovieProviders, getTvProviders };
