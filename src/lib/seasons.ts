/** Client-safe catalog of the seasonal themes. Dates live in `server/season-dates.ts`. */

export type SeasonId = 'halloween' | 'advent' | 'carnival' | 'party';

export interface Season {
	id: SeasonId;
	label: string;
	icon: 'ghost' | 'snowflake' | 'party-popper' | 'sparkles';
	tagline: string;
}

export const SEASONS: readonly Season[] = [
	{
		id: 'halloween',
		label: 'Halloween',
		icon: 'ghost',
		tagline: 'Spooky season. Post responsibly.'
	},
	{
		id: 'advent',
		label: 'Advent',
		icon: 'snowflake',
		tagline: 'Cozy memes, cold hands.'
	},
	{
		id: 'carnival',
		label: 'Carnival',
		icon: 'party-popper',
		tagline: 'Costumes optional, memes mandatory.'
	},
	{
		id: 'party',
		label: 'Party',
		icon: 'sparkles',
		tagline: 'Something to celebrate.'
	}
];

export function seasonById(id: string): Season | undefined {
	return SEASONS.find((season) => season.id === id);
}
