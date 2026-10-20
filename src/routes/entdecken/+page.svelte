<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import DiscoverSlide from '#lib/components/DiscoverSlide.svelte';
	import type { FeedItem } from '../../lib/server/feed';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Share of a slide that must be visible before it counts as the active one. */
	const ACTIVE_RATIO = 0.6;
	/** Most recent loaded ids sent as `exclude`; the API keeps the same window. */
	const EXCLUDE_MAX = 500;

	type Entry = { kind: 'meme'; item: FeedItem } | { kind: 'break' };

	let entries = $state<Entry[]>([]);
	let loading = false;
	let exhausted = false;
	let replaying = false;
	const loaded = new SvelteSet<number>();
	const marked = new SvelteSet<number>();

	function append(items: FeedItem[], caughtUp: boolean) {
		const fresh = items.filter((item) => !loaded.has(item.id));
		// Nothing new (empty or all duplicates of ids the exclude window forgot): stop refilling.
		if (fresh.length === 0) {
			exhausted = true;
			return;
		}
		if (caughtUp && !replaying) {
			replaying = true;
			entries.push({ kind: 'break' });
		}
		for (const item of fresh) {
			loaded.add(item.id);
			entries.push({ kind: 'meme', item });
		}
	}

	// First batch is server-rendered; later batches come from /api/discover.
	// svelte-ignore state_referenced_locally
	append(data.items, data.caughtUp);

	async function loadMore() {
		if (loading || exhausted) return;
		loading = true;
		try {
			const res = await fetch(`/api/discover?exclude=${[...loaded].slice(-EXCLUDE_MAX).join(',')}`);
			if (!res.ok) throw new Error(String(res.status));
			const batch = (await res.json()) as { items: FeedItem[]; caughtUp: boolean };
			append(batch.items, batch.caughtUp);
		} catch {
			// transient failure: the next snap into the tail retries
		} finally {
			loading = false;
		}
	}

	function markSeen(id: number) {
		if (marked.has(id)) return;
		marked.add(id);
		void fetch(`/api/memes/${id}/seen`, { method: 'POST' }).catch(() => marked.delete(id));
	}

	// A slide counts as active once 60% of it is on screen (the pager fills the viewport).
	const observer =
		typeof window !== 'undefined'
			? new IntersectionObserver(
					(hits) => {
						for (const hit of hits) {
							// callbacks also fire when a slide merely starts to peek in; only count real activation
							if (!hit.isIntersecting || hit.intersectionRatio < ACTIVE_RATIO) continue;
							const el = hit.target as HTMLElement;
							if (el.dataset.id) markSeen(Number(el.dataset.id));
							if (Number(el.dataset.index) >= entries.length - 3) void loadMore();
						}
					},
					{ threshold: ACTIVE_RATIO }
				)
			: null;

	function watch(el: HTMLElement) {
		observer?.observe(el);
		return () => observer?.unobserve(el);
	}
</script>

<svelte:head>
	<title>Entdecken · Loki</title>
</svelte:head>

<main class="pager">
	{#each entries as entry, i (entry.kind === 'meme' ? entry.item.id : 'break')}
		<section
			class="slide"
			data-index={i}
			data-id={entry.kind === 'meme' ? entry.item.id : undefined}
			{@attach watch}
		>
			{#if entry.kind === 'meme'}
				<DiscoverSlide item={entry.item} />
			{:else}
				<div class="interstitial">
					<h1>Du bist auf dem Laufenden!</h1>
					<p>Ab hier: alte Perlen im Zufallsmix</p>
				</div>
			{/if}
		</section>
	{:else}
		<section class="slide">
			<div class="interstitial">
				<h1>Noch keine Memes</h1>
				<p>Lade das erste hoch!</p>
			</div>
		</section>
	{/each}
</main>

<style>
	.pager {
		height: 100dvh;
		overflow-y: scroll;
		scroll-snap-type: y mandatory;
		overscroll-behavior-y: contain;
	}

	.slide {
		position: relative;
		height: 100dvh;
		scroll-snap-align: start;
		scroll-snap-stop: always;
	}

	.interstitial {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 0 24px var(--tabbar-height);
		text-align: center;
	}

	.interstitial h1 {
		margin: 0 0 8px;
		font-size: 26px;
	}

	.interstitial p {
		margin: 0;
		color: var(--text-muted);
	}
</style>
