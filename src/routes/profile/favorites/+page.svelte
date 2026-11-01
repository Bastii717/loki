<script lang="ts">
	import SeasonEffect from '#lib/components/SeasonEffect.svelte';
	import { resolve } from '$app/paths';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import FeedList from '#lib/components/FeedList.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Favorites · Loki</title>
</svelte:head>

<header class="top season-host">
	<SeasonEffect season={data.season?.id} />
	<a href={resolve('/profile')} class="back" aria-label="Back to profile"><ArrowLeft size={22} /></a
	>
	<h1>Favorites</h1>
</header>

<main>
	<FeedList
		items={data.items}
		nextCursor={data.nextCursor}
		list="favorites"
		empty="No favorites yet — tap the star on a meme."
	/>
</main>

<style>
	.top {
		position: sticky;
		/* below the status banner strip, when there is one */
		top: var(--banners-height, 0px);
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 8px;
		background: var(--bg);
	}

	.back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
	}

	h1 {
		margin: 0;
		font-size: 18px;
	}

	main {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}
</style>
