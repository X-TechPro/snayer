// Progress tracking for stream sniffing
const progressMap = new Map();

export function getProgress(tmdb) {
    return progressMap.get(tmdb) || { statuses: ["pending", "pending", "pending", "pending"], found: null };
}

export function setProgress(tmdb, statuses, found) {
    progressMap.set(tmdb, { statuses: [...statuses], found });
}

export function clearProgress(tmdb) {
    progressMap.delete(tmdb);
}
