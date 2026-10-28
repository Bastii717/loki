<script lang="ts">
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
	</dl>

	<FeedList
		items={data.items}
		nextCursor={data.nextCursor}
		list="user"
		uploader={member.id}
		empty="No memes yet."
	/>
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
		margin: 16px 0;
	}

	.counts div {
		padding: 10px;
		border-radius: var(--radius);
		background: var(--surface);
		text-align: center;
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
