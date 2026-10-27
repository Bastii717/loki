<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, setContext } from 'svelte';
	import StatusBanner from '#lib/components/StatusBanner.svelte';
	import TabBar from '#lib/components/TabBar.svelte';
	import TimeoutBanner from '#lib/components/TimeoutBanner.svelte';
	import { STATUS_KEY } from '../lib/status-context';
	import { nextRefreshDelay } from '../lib/status-refresh';
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

	// While a lock is shown, ask the server again every minute, when the tab becomes visible and
	// just after the window is due to start or end, so the lock lifts without a reload.
	$effect(() => {
		if (data.status.state === 'ok') return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let handled: string | null = null;
		const refresh = () => void invalidate('loki:status').catch(() => {});
		const schedule = () => {
			const { state, nextChangeAt } = data.status;
			// a change instant that was already acted on and is still reported (clock skew) is ignored
			const delay = nextRefreshDelay(
				{ state, nextChangeAt: nextChangeAt === handled ? null : nextChangeAt },
				Date.now()
			);
			if (delay === null) return;
			timer = setTimeout(() => {
				handled = data.status.nextChangeAt;
				refresh();
				schedule();
			}, delay);
		};
		const onVisible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		schedule();
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearTimeout(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	// The server renders data-season on <html>; client navigations and invalidations keep it in sync.
	$effect(() => {
		const root = document.documentElement;
		if (data.season) root.dataset.season = data.season.id;
		else delete root.dataset.season;
	});

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
