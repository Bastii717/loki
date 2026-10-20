<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import FeedList from '#lib/components/FeedList.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Favoriten · Loki</title>
</svelte:head>

<header class="top">
	<a href={resolve('/profil')} class="back" aria-label="Zurück zum Profil"
		><ArrowLeft size={22} /></a
	>
	<h1>Favoriten</h1>
</header>

<main>
	<FeedList
		items={data.items}
		nextCursor={data.nextCursor}
		list="favorites"
		empty="Noch keine Favoriten — tippe bei einem Meme auf den Stern."
	/>
</main>

<style>
	.top {
		position: sticky;
		top: 0;
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
