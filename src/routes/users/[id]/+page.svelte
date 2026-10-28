<script lang="ts">
	import { resolve } from '$app/paths';
	import Trophy from 'lucide-svelte/icons/trophy';
	import Avatar from '#lib/components/Avatar.svelte';
	import FeedList from '#lib/components/FeedList.svelte';
	import RoleBadge from '#lib/components/RoleBadge.svelte';
	import { formatMonthYear } from '../../../lib/moderation-labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const member = $derived(data.member);
</script>

<svelte:head>
	<title>{member.name} · Loki</title>
</svelte:head>

<main>
	<header>
		<Avatar key={member.avatarKey} thumbKey={member.avatarThumbKey} name={member.name} size={96} />
		<h1>
			{member.name}
			<RoleBadge role={member.role} />
		</h1>
		{#if member.username}<p class="username">{member.username}</p>{/if}
		{#if member.motto}<p class="motto">{member.motto}</p>{/if}
		<p class="since">Member since {formatMonthYear(member.memberSince)}</p>
	</header>

	<dl class="counts">
		<div>
			<dt>Memes</dt>
			<dd>{data.memeCount}</dd>
		</div>
		<div>
			<dt>Awards</dt>
			<dd>{data.awards.length}</dd>
		</div>
	</dl>

	{#if data.awards.length > 0}
		<p class="award-chips">
			{#each data.awards as award (award.month)}
				<a class="award-chip" href="{resolve('/awards')}?from={award.month}#{award.month}"
					><Trophy size={12} aria-hidden="true" /> {formatMonthYear(award.month)}</a
				>
			{/each}
		</p>
	{/if}

	{#key member.id}
		<FeedList
			items={data.items}
			nextCursor={data.nextCursor}
			list="user"
			uploader={member.id}
			empty="No memes yet."
		/>
	{/key}
</main>

<style>
	main {
		max-width: 560px;
		margin: 0 auto;
		padding: 16px var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}

	header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		text-align: center;
	}

	h1 {
		margin: 6px 0 0;
		font-size: 22px;
		overflow-wrap: anywhere;
	}

	.username,
	.motto,
	.since {
		margin: 0;
		max-width: 100%;
		overflow-wrap: anywhere;
	}

	.username,
	.since {
		color: var(--text-muted);
		font-size: 14px;
	}

	.motto {
		font-size: 15px;
	}

	.counts {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
		margin: 16px 0;
	}

	.counts div {
		padding: 10px;
		border-radius: var(--radius);
		background: var(--surface);
		text-align: center;
	}

	.award-chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		margin: -4px 0 16px;
	}

	.award-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 28px;
		padding: 0 10px;
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent-soft-text);
		font-size: 12px;
		font-weight: 600;
	}

	dt {
		color: var(--text-muted);
		font-size: 12px;
	}

	dd {
		margin: 2px 0 0;
		font-size: 20px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
</style>
