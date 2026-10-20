<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import TabBar from '#lib/components/TabBar.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	// The upload screen is its own full-screen flow, so it has no tab bar.
	const showTabs = $derived(data.user !== null && !page.url.pathname.startsWith('/upload'));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

{#if showTabs}
	<TabBar pathname={page.url.pathname} />
{/if}
