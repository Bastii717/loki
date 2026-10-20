<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import MemeCard from '#lib/components/MemeCard.svelte';
	import type { FeedItem } from '../lib/server/feed';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const sorts = [
		{ key: 'new', label: 'Neu' },
		{ key: 'hot', label: 'Hot' },
		{ key: 'hof', label: 'Hall of Fame' }
	] as const;

	let items: FeedItem[] = $state([]);
	let nextCursor: string | null = $state(null);
	let loading = $state(false);
	let failed = $state(false);
	let sentinel: HTMLElement | undefined = $state();

	// A new sort/tag navigation delivers a fresh first page: start over from it.
	$effect.pre(() => {
		items = data.items;
		nextCursor = data.nextCursor;
		failed = false;
	});

	const feedQuery = (sort: string, tag: string | null) => {
		const params = new SvelteURLSearchParams();
		if (sort !== 'new') params.set('sort', sort);
		if (tag) params.set('tag', tag);
		const qs = params.toString();
		return qs ? `?${qs}` : '';
	};

	async function loadMore() {
		if (loading || !nextCursor) return;
		loading = true;
		failed = false;
		const params = new SvelteURLSearchParams({ sort: data.sort, cursor: nextCursor });
		if (data.tag) params.set('tag', data.tag);
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

<svelte:head>
	<title>Loki</title>
</svelte:head>

<header class="top">
	<span class="brand">Loki</span>
	<form method="POST" action="/logout">
		<button type="submit" class="logout" title="Angemeldet als {data.user?.username}">
			Abmelden
		</button>
	</form>
</header>

<main class="feed">
	<nav class="filters" aria-label="Sortierung">
		{#each sorts as s (s.key)}
			<a
				href="{resolve('/')}{feedQuery(s.key, data.tag)}"
				class="chip sort"
				aria-current={data.sort === s.key ? 'true' : undefined}>{s.label}</a
			>
		{/each}
	</nav>

	{#if data.tag}
		<p class="active-tag">
			<span class="chip tag">
				#{data.tag}
				<a href="{resolve('/')}{feedQuery(data.sort, null)}" aria-label="Tag-Filter entfernen">✕</a>
			</span>
		</p>
	{/if}

	{#if items.length === 0}
		<p class="empty">
			{data.tag ? `Keine Memes mit #${data.tag}.` : 'Noch keine Memes — lade das erste hoch!'}
		</p>
	{:else}
		<div class="list">
			{#each items as item (item.id)}
				<MemeCard {item} />
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
	{:else if items.length > 0}
		<p class="end muted">Das war's — du bist am Ende. 🎉</p>
	{/if}
</main>

<style>
	.top {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		background: var(--bg);
	}

	.brand {
		font-size: 18px;
		font-weight: 800;
		letter-spacing: 0.3px;
	}

	.logout {
		padding: 6px 10px;
		border: 0;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--text-muted);
		font-size: 13px;
		cursor: pointer;
	}

	.feed {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}

	.filters {
		display: flex;
		gap: 8px;
		margin-bottom: 10px;
		overflow-x: auto;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border-radius: var(--radius-pill);
		white-space: nowrap;
		font-size: 14px;
	}

	.sort {
		background: var(--surface);
		color: var(--text-muted);
	}

	.sort[aria-current='true'] {
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}

	.active-tag {
		margin: 0 0 10px;
	}

	.tag {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.tag a {
		padding: 0 2px;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.more,
	.end,
	.empty {
		padding: 24px 0;
		text-align: center;
	}

	.muted {
		color: var(--text-muted);
		font-size: 13px;
	}

	.empty {
		color: var(--text-muted);
	}

	.retry {
		padding: 10px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		cursor: pointer;
	}
</style>
