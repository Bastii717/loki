<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { onMount, setContext } from 'svelte';
	import StatusBanner from '#lib/components/StatusBanner.svelte';
	import TabBar from '#lib/components/TabBar.svelte';
	import TimeoutBanner from '#lib/components/TimeoutBanner.svelte';
	import { STATUS_KEY } from '../lib/status-context';
	import { watchThemeColor } from '../lib/theme';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	// Components read the status through `useStatus()`; the getter follows `data` after `invalidateAll()`.
	setContext(STATUS_KEY, {
		get value() {
			return data.status;
		}
	});

	// The banner strip is in flow and sticky; pages offset their sticky headers (and Discover its
	// full-height container) by its measured height through `--banners-height`.
	let bannersHeight = $state(0);
	const showBanners = $derived(Boolean(data.status.message || data.activeTimeout));

	// the toggle only lives on the feed page, the meta must follow the theme on every page
	onMount(watchThemeColor);

	// The upload screen is its own full-screen flow, so it has no tab bar.
	const showTabs = $derived(data.user !== null && !page.url.pathname.startsWith('/upload'));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- One sticky strip: the status banner first, the timeout banner below it, so neither hides the other. -->
{#if showBanners}
	<div class="banners" bind:clientHeight={bannersHeight}>
		<StatusBanner state={data.status.state} message={data.status.message} />
		{#if data.activeTimeout}
			<TimeoutBanner until={data.activeTimeout.until} reason={data.activeTimeout.reason} />
		{/if}
	</div>
{/if}

<div class="shell" style:--banners-height="{showBanners ? bannersHeight : 0}px">
	{@render children()}
</div>

{#if showTabs}
	<TabBar pathname={page.url.pathname} badge={data.openCases ?? 0} />
{/if}

<style>
	.banners {
		position: sticky;
		top: 0;
		z-index: 40;
		padding-top: env(safe-area-inset-top);
		background: var(--surface-raised);
		box-shadow: 0 2px 8px var(--overlay);
	}
</style>
