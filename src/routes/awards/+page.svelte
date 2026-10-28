<script lang="ts">
	import { resolve } from '$app/paths';
	import MemeCard from '#lib/components/MemeCard.svelte';
	import { formatDate, formatMonthLong, pluralize } from '../../lib/moderation-labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const leadNote = $derived(
		data.leading
			? `Leads ${formatMonthLong(data.leading.month)} with ${pluralize(data.leading.score, 'point', 'points')}`
			: ''
	);
</script>

<svelte:head>
	<title>Meme of the Month · Loki</title>
</svelte:head>

<header class="top">
	<h1>Meme of the Month</h1>
</header>

<main>
	{#if data.leading}
		<section class="leading" aria-labelledby="leading-heading">
			<h2 id="leading-heading">Leading right now</h2>
			<MemeCard item={data.leading.item} feedIds={[data.leading.item.id]} />
			<p class="note">{leadNote}</p>
		</section>
	{/if}

	{#each data.sections as section (section.month)}
		<section id={section.month}>
			<h2>{formatMonthLong(section.month)}</h2>
			{#if section.item}
				<MemeCard item={section.item} feedIds={[section.item.id]} />
			{:else}
				<p class="deleted">“{section.title}” (deleted)</p>
			{/if}
		</section>
	{/each}

	{#if data.sections.length === 0}
		<p class="empty">No winners yet. The first month closes on {formatDate(data.firstClose)}.</p>
	{/if}

	{#if data.hasMore && data.nextBefore}
		<div class="pager">
			<a href="{resolve('/awards')}?before={data.nextBefore}">Show older</a>
		</div>
	{/if}
</main>

<style>
	.top {
		position: sticky;
		/* below the status banner strip, when there is one */
		top: var(--banners-height, 0px);
		z-index: 5;
		display: flex;
		align-items: center;
		max-width: 560px;
		margin: 0 auto;
		padding: 6px var(--gutter);
		background: var(--bg);
	}

	h1 {
		margin: 0;
		font-size: 18px;
	}

	h2 {
		margin: 0 0 8px;
		font-size: 14px;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.4px;
	}

	main {
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 560px;
		margin: 0 auto;
		padding: 4px var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}

	section {
		min-width: 0;
		/* a ?from= link scrolls the month below the sticky header */
		scroll-margin-top: 56px;
	}

	.note {
		margin: 8px 0 0;
		color: var(--text-muted);
		font-size: 13px;
	}

	.deleted,
	.empty {
		margin: 0;
		color: var(--text-muted);
	}

	.deleted {
		padding: 12px;
		border-radius: var(--radius);
		background: var(--surface);
		font-size: 14px;
		overflow-wrap: anywhere;
	}

	.empty {
		margin: 8px 0;
		text-align: center;
	}

	.pager {
		display: flex;
		justify-content: center;
	}

	.pager a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		font-weight: 600;
	}
</style>
