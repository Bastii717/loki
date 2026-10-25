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

	// the toggle only lives on the feed page, the meta must follow the theme on every page
	onMount(watchThemeColor);

	// The upload screen is its own full-screen flow, so it has no tab bar.
	const showTabs = $derived(data.user !== null && !page.url.pathname.startsWith('/upload'));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- One fixed strip: the status banner first, the timeout banner below it, so neither hides the other. -->
{#if data.status.message || data.activeTimeout}
	<div class="banners">
		<StatusBanner state={data.status.state} message={data.status.message} />
		{#if data.activeTimeout}
			<TimeoutBanner until={data.activeTimeout.until} reason={data.activeTimeout.reason} />
		{/if}
	</div>
{/if}

{@render children()}

{#if showTabs}
	<TabBar pathname={page.url.pathname} badge={data.openCases ?? 0} />
{/if}

<style>
	.banners {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 40;
		padding-top: env(safe-area-inset-top);
		background: var(--surface-raised);
		box-shadow: 0 2px 8px var(--overlay);
	}
</style>
