<script lang="ts">
	import { resolve } from '$app/paths';
	import Compass from 'lucide-svelte/icons/compass';
	import House from 'lucide-svelte/icons/house';
	import Plus from 'lucide-svelte/icons/plus';
	import Quote from 'lucide-svelte/icons/quote';
	import User from 'lucide-svelte/icons/user';
	/** `badge`: open moderation cases, only passed for moderators/admins; shown as a dot-count on Profile. */
	let { pathname, badge = 0 }: { pathname: string; badge?: number } = $props();

	// Discover, Quotes and Profile arrive in later tasks; their links 404 until then.
	const left = [
		{ href: '/', label: 'Feed', icon: House },
		{ href: '/discover', label: 'Discover', icon: Compass }
	];
	const right = [
		{ href: '/quotes', label: 'Quotes', icon: Quote },
		{ href: '/profile', label: 'Profile', icon: User }
	];

	const isActive = (href: string) =>
		href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
</script>

<nav class="tabbar" aria-label="Main navigation">
	{#each left as tab (tab.href)}
		<a
			href={resolve(tab.href as '/')}
			class="tab"
			aria-current={isActive(tab.href) ? 'page' : undefined}
		>
			<tab.icon size={22} aria-hidden="true" />
			<span class="label">{tab.label}</span>
		</a>
	{/each}
	<a href={resolve('/upload')} class="fab" aria-label="Post a meme"
		><Plus size={26} strokeWidth={2.5} aria-hidden="true" /></a
	>
	{#each right as tab (tab.href)}
		<a
			href={resolve(tab.href as '/')}
			class="tab"
			aria-current={isActive(tab.href) ? 'page' : undefined}
		>
			<span class="icon">
				<tab.icon size={22} aria-hidden="true" />
				{#if tab.href === '/profile' && badge > 0}
					<span class="badge" role="img" aria-label="{badge} open reports"
						>{badge > 9 ? '9+' : badge}</span
					>
				{/if}
			</span>
			<span class="label">{tab.label}</span>
		</a>
	{/each}
</nav>

<style>
	.tabbar {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 10;
		display: grid;
		grid-template-columns: 1fr 1fr 64px 1fr 1fr;
		align-items: center;
		min-height: var(--tabbar-height);
		padding-bottom: env(safe-area-inset-bottom);
		background: var(--bg);
		border-top: 1px solid var(--border);
	}

	/* wide screens: keep the strip full-width, but seat the items under the 560px feed column */
	@media (min-width: 768px) {
		.tabbar {
			padding-inline: calc((100% - 560px) / 2);
		}
	}

	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		min-height: var(--tabbar-height);
		color: var(--text-muted);
		font-size: 11px;
	}

	.icon {
		position: relative;
		display: flex;
	}

	.badge {
		position: absolute;
		top: -4px;
		right: -10px;
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

	.tab[aria-current='page'] {
		color: var(--text);
	}

	.fab {
		justify-self: center;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		margin-top: -16px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--accent-text);
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
	}
</style>
