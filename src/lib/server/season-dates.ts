import type { SeasonId } from '../seasons';

interface CalendarDate {
	year: number;
	month: number;
	day: number;
}

const berlin = new Intl.DateTimeFormat('en-GB', {
	timeZone: 'Europe/Berlin',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

const DAY_MS = 86_400_000;

/** Easter Sunday of a Gregorian year (anonymous Gregorian algorithm, Meeus/Jones/Butcher). */
export function easterSunday(year: number): { month: number; day: number } {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return { month, day };
}

/** The calendar date in Berlin at the instant. */
export function berlinDate(instant: Date): CalendarDate {
	const p: Record<string, string> = {};
	for (const part of berlin.formatToParts(instant)) p[part.type] = part.value;
	return { year: +p.year, month: +p.month, day: +p.day };
}

/** Orders calendar dates as (year, month, day) tuples. */
function ordinal({ year, month, day }: CalendarDate): number {
	return year * 10_000 + month * 100 + day;
}

/** Easter Sunday shifted by whole days, as a calendar date. */
function easterOffset(year: number, days: number): CalendarDate {
	const { month, day } = easterSunday(year);
	const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate()
	};
}

function within(date: CalendarDate, from: CalendarDate, to: CalendarDate): boolean {
	const value = ordinal(date);
	return value >= ordinal(from) && value <= ordinal(to);
}

/**
 * The season that is switched on by the calendar at the instant (Berlin date), or null.
 * Halloween: Oct 25 - Nov 1. Advent: Dec 1 - Dec 26. Carnival: Weiberfastnacht (Easter - 52 days)
 * through Ash Wednesday (Easter - 46 days). `party` is never date-driven; admins force it.
 */
export function seasonForDate(instant: Date): SeasonId | null {
	const date = berlinDate(instant);
	const { year } = date;
	if (within(date, { year, month: 10, day: 25 }, { year, month: 11, day: 1 })) return 'halloween';
	if (within(date, { year, month: 12, day: 1 }, { year, month: 12, day: 26 })) return 'advent';
	if (within(date, easterOffset(year, -52), easterOffset(year, -46))) return 'carnival';
	return null;
}
