<script lang="ts">
	import { resolve } from '$app/paths';
	import Clock from 'lucide-svelte/icons/clock';
	import Flame from 'lucide-svelte/icons/flame';
	import Search from 'lucide-svelte/icons/search';
	import Trophy from 'lucide-svelte/icons/trophy';
	import X from 'lucide-svelte/icons/x';
	import { untrack } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import Avatar from '#lib/components/Avatar.svelte';
	import MemeCard from '#lib/components/MemeCard.svelte';
	import SeasonIcon from '#lib/components/SeasonIcon.svelte';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import type { FeedItem } from '../lib/server/feed';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const sorts = [
		{ key: 'new', label: 'New', icon: Clock },
		{ key: 'hot', label: 'Hot', icon: Flame },
		{ key: 'hof', label: 'Hall of Fame', icon: Trophy }
	] as const;

	// initialised from props so the first page is part of the server-rendered HTML
	let items: FeedItem[] = $state(untrack(() => data.items));
	let nextCursor: string | null = $state(untrack(() => data.nextCursor));
	let loading = $state(false);
	let failed = $state(false);
	let sentinel: HTMLElement | undefined = $state();

	// A new sort/tag navigation delivers a fresh first page: start over from it.
	$effect.pre(() => {
		items = data.items;
		nextCursor = data.nextCursor;
		failed = false;
	});

	const feedIds = $derived(items.map((i) => i.id));

	const myName = $derived(data.user?.displayName ?? data.user?.username ?? '');
	const openCases = $derived(data.openCases ?? 0);

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
	<span class="brand-group">
		<span class="brand">Loki</span>
		{#if data.season}
			<SeasonIcon icon={data.season.icon} label={data.season.label} />
		{/if}
	</span>
	<div class="actions">
		<a href={resolve('/search')} class="search" aria-label="Search"
			><Search size={20} aria-hidden="true" /></a
		>
		<ThemeToggle />
		<!-- Sign out lives on the profile page; the open-cases count follows the profile here. -->
		<a
			href={resolve('/profile')}
			class="me"
			aria-label={openCases > 0
				? `Profile, ${openCases} open ${openCases === 1 ? 'report' : 'reports'}`
				: 'Profile'}
			title="Signed in as {myName}"
		>
			<Avatar key={data.avatar?.key} thumbKey={data.avatar?.thumbKey} name={myName} size={30} />
			{#if openCases > 0}
				<span class="badge" aria-hidden="true">{openCases > 9 ? '9+' : openCases}</span>
			{/if}
		</a>
	</div>
</header>

<main class="feed">
	<nav class="filters" aria-label="Sort">
		{#each sorts as s (s.key)}
			<a
				href="{resolve('/')}{feedQuery(s.key, data.tag)}"
				class="chip sort"
				aria-current={data.sort === s.key ? 'true' : undefined}
				><s.icon size={16} aria-hidden="true" />{s.label}</a
			>
		{/each}
	</nav>

	{#if data.sort === 'hof'}
		<a href={resolve('/awards')} class="awards-link"
			><Trophy size={14} aria-hidden="true" /> Meme of the Month
			<span aria-hidden="true">→</span></a
		>
	{/if}

	{#if data.tag}
		<p class="active-tag">
			<span class="chip tag">
				#{data.tag}
				<a href="{resolve('/')}{feedQuery(data.sort, null)}" aria-label="Remove tag filter"
					><X size={14} aria-hidden="true" /></a
				>
			</span>
		</p>
	{/if}

	{#if items.length === 0}
		<p class="empty">
			{data.tag ? `No memes tagged #${data.tag}.` : 'No memes yet — upload the first one!'}
		</p>
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
				<button type="button" class="retry" onclick={loadMore}> Loading failed — try again </button>
			{:else}
				<span class="muted">Loading more…</span>
			{/if}
		</div>
	{:else if items.length > 0}
		<p class="end muted">That's everything — you've hit the bottom.</p>
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
		justify-content: space-between;
		padding: 10px 14px;
		background: var(--bg);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.search {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-pill);
		color: var(--text-muted);
	}

	.brand-group {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.brand {
		font-size: 18px;
		font-weight: 800;
		letter-spacing: 0.3px;
	}

	.me {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		margin-left: 2px;
		border-radius: var(--radius-pill);
	}

	.badge {
		position: absolute;
		top: 0;
		right: -4px;
		min-width: 16px;
		padding: 0 4px;
		border-radius: var(--radius-pill);
		background: var(--down);
		color: #fff;
		font-size: 10px;
		font-weight: 700;
		line-height: 16px;
		text-align: center;
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

	.awards-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		margin: 0 0 4px;
		color: var(--accent-soft-text);
		font-size: 14px;
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
		display: flex;
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
