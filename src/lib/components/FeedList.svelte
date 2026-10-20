<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import MemeCard from './MemeCard.svelte';
	import type { FeedItem } from '../server/feed';

	/** A card list with infinite scroll against /api/feed?list=…, used by the profile sub-pages. */
	let {
		items: initialItems,
		nextCursor: initialCursor,
		list,
		empty
	}: {
		items: FeedItem[];
		nextCursor: string | null;
		list: 'mine' | 'favorites';
		empty: string;
	} = $props();

	let items: FeedItem[] = $state(untrack(() => initialItems));
	let nextCursor: string | null = $state(untrack(() => initialCursor));
	let loading = $state(false);
	let failed = $state(false);
	let sentinel: HTMLElement | undefined = $state();

	const feedIds = $derived(items.map((i) => i.id));

	async function loadMore() {
		if (loading || !nextCursor) return;
		loading = true;
		failed = false;
		const params = new SvelteURLSearchParams({ sort: 'new', cursor: nextCursor, list });
		try {
			const res = await fetch(`/api/feed?${params}`);
			if (!res.ok) throw new Error(String(res.status));
			const page: { items: FeedItem[]; nextCursor: string | null } = await res.json();
			const known = new Set(items.map((i) => i.id));
			items.push(...page.items.filter((i) => !known.has(i.id)));
			nextCursor = page.nextCursor;
		} catch {
			failed = true;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!sentinel || !nextCursor || failed) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) void loadMore();
			},
			{ rootMargin: '600px 0px' }
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

{#if items.length === 0}
	<p class="empty">{empty}</p>
{:else}
	<div class="list">
		{#each items as item (item.id)}
			<MemeCard {item} {feedIds} />
		{/each}
	</div>
{/if}

{#if nextCursor}
	<div class="more" bind:this={sentinel}>
		{#if failed}
			<button type="button" class="retry" onclick={loadMore}>
				Laden fehlgeschlagen — Erneut versuchen
			</button>
		{:else}
			<span class="muted">Lade mehr …</span>
		{/if}
	</div>
{/if}

<style>
	.list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.more,
	.empty {
		padding: 24px 0;
		text-align: center;
	}

	.muted,
	.empty {
		color: var(--text-muted);
	}

	.muted {
		font-size: 13px;
	}

	.retry {
		padding: 10px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		cursor: pointer;
	}
</style>
