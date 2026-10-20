/** German relative time such as „vor 2 h"; falls back to a date after a week. */
export function relativeTime(iso: string, now: number = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
	if (seconds < 60) return 'gerade eben';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `vor ${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `vor ${hours} h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `vor ${days} d`;
	return new Date(iso).toLocaleDateString('de-DE');
}
