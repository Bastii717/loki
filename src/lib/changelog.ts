export type ChangelogEntry = { id: string; lines: string[] };

// Newest first. Add an entry per release; the feed card shows CHANGELOG[0] once per id.
export const CHANGELOG: ChangelogEntry[] = [
	{
		id: 'v1.10.0',
		lines: [
			'You can now send the admins feedback — find it on your profile.',
			"After every update, this card tells you what's new."
		]
	}
];
