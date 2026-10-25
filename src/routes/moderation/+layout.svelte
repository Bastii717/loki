<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Shield from 'lucide-svelte/icons/shield';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const tabs = $derived([
		{ href: '/moderation', label: 'Queue', count: data.openCases },
		{ href: '/moderation/resolved', label: 'Resolved', count: 0 },
		{ href: '/moderation/timeouts', label: 'Timeouts', count: 0 },
		...(data.isAdmin
			? [
					{ href: '/moderation/users', label: 'Users', count: 0 },
					{ href: '/moderation/maintenance', label: 'Maintenance', count: 0 }
				]
			: []),
		{ href: '/moderation/log', label: 'Log', count: 0 }
	]);

	const isActive = (href: string) =>
		href === '/moderation'
			? page.url.pathname === href
			: page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
</script>

<header class="top">
	<a href={resolve('/profile')} class="back" aria-label="Back to profile"><ArrowLeft size={22} /></a
	>
	<h1><Shield size={20} aria-hidden="true" /> Moderation</h1>
</header>

<nav class="tabs" aria-label="Moderation">
	{#each tabs as tab (tab.href)}
		<a
			href={resolve(tab.href as '/moderation')}
			aria-current={isActive(tab.href) ? 'page' : undefined}
		>
			{tab.label}
			{#if tab.count > 0}<span class="count" aria-label="{tab.count} open">{tab.count}</span>{/if}
		</a>
	{/each}
</nav>

<div class="mod">
	{@render children()}
</div>

<style>
	.top {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 8px 0;
		max-width: 640px;
		margin: 0 auto;
	}

	.back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
	}

	h1 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 18px;
	}

	.tabs {
		position: sticky;
		/* below the status banner strip, when there is one */
		top: var(--banners-height, 0px);
		z-index: 5;
		display: flex;
		gap: 4px;
		max-width: 640px;
		margin: 0 auto;
		padding: 4px var(--gutter);
		overflow-x: auto;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
		scrollbar-width: none;
	}

	.tabs a {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 40px;
		padding: 0 14px;
		border-radius: var(--radius-pill);
		color: var(--text-muted);
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
	}

	.tabs a[aria-current='page'] {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.count {
		min-width: 20px;
		padding: 0 6px;
		border-radius: var(--radius-pill);
		background: var(--down);
		color: #fff;
		font-size: 12px;
		line-height: 20px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.mod {
		max-width: 640px;
		margin: 0 auto;
		padding: 12px var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	/* shared building blocks of all moderation pages */
	.mod :global(.card) {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		min-width: 0;
	}

	.mod :global(.list) {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.mod :global(.pill) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		background: var(--surface-raised);
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
	}

	.mod :global(.pill.accent) {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.mod :global(.muted) {
		margin: 0;
		color: var(--text-muted);
		font-size: 13px;
	}

	.mod :global(.error) {
		margin: 0;
		color: var(--down);
		font-size: 14px;
	}

	.mod :global(.ok) {
		margin: 0;
		color: var(--up);
		font-size: 14px;
	}

	.mod :global(.empty) {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		margin: 24px 0;
		color: var(--text-muted);
		text-align: center;
	}

	.mod :global(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 14px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-raised);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}

	.mod :global(.btn.primary) {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}

	.mod :global(.btn.danger) {
		border-color: var(--down);
		background: var(--down);
		color: #fff;
	}

	.mod :global(.btn:disabled) {
		opacity: 0.55;
		cursor: default;
	}

	.mod :global(.field) {
		width: 100%;
		min-width: 0;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-raised);
		color: var(--text);
		font: inherit;
	}

	.mod :global(.pager) {
		display: flex;
		justify-content: center;
		gap: 8px;
	}

	.mod :global(.pager a) {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		font-weight: 600;
	}
</style>
