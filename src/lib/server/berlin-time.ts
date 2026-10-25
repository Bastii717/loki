const berlin = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Berlin',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const HOUR_MS = 3_600_000;

/** Wall-clock time in Berlin at the instant `ms`, read as if it were UTC (minute precision). */
function berlinWallClock(ms: number): number {
	const p: Record<string, string> = {};
	for (const part of berlin.formatToParts(new Date(ms))) p[part.type] = part.value;
	return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
}

/**
 * The UTC instant whose Berlin wall clock reads `value` (a `datetime-local` string,
 * `YYYY-MM-DDTHH:mm`). Berlin is UTC+1 in winter and UTC+2 in summer, so there are two candidate
 * instants: the earlier one (summer offset) wins when both fit (the repeated hour in autumn); a
 * time skipped by the spring switch lands an hour later. Throws a RangeError for anything that
 * is not a valid local date and time.
 */
export function fromBerlinLocal(value: string): Date {
	const m = LOCAL.exec(value);
	if (!m) throw new RangeError(`Not a local date and time: ${value}`);
	const [year, month, day, hour, minute] = m.slice(1).map(Number);
	const wall = Date.UTC(year, month - 1, day, hour, minute);
	const check = new Date(wall);
	if (
		check.getUTCFullYear() !== year ||
		check.getUTCMonth() !== month - 1 ||
		check.getUTCDate() !== day ||
		check.getUTCHours() !== hour
	) {
		throw new RangeError(`Not a local date and time: ${value}`);
	}
	const summer = wall - 2 * HOUR_MS;
	const winter = wall - HOUR_MS;
	return new Date(berlinWallClock(summer) === wall ? summer : winter);
}

/** `YYYY-MM-DDTHH:mm` in Berlin time, the value format of a `datetime-local` input. */
export function toBerlinLocal(date: Date): string {
	return new Date(berlinWallClock(date.getTime())).toISOString().slice(0, 16);
}
