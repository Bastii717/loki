<script lang="ts">
	import { resolve } from '$app/paths';
	let { pathname }: { pathname: string } = $props();

	// Entdecken, Quotes and Profil arrive in later tasks; their links 404 until then.
	const left = [
		{ href: '/', label: 'Feed', icon: '🏠' },
		{ href: '/entdecken', label: 'Entdecken', icon: '🔥' }
	];
	const right = [
		{ href: '/quotes', label: 'Quotes', icon: '💬' },
		{ href: '/profil', label: 'Profil', icon: '👤' }
	];

	const isActive = (href: string) =>
		href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
</script>

<nav class="tabbar" aria-label="Hauptnavigation">
	{#each left as tab (tab.href)}
		<a
			href={resolve(tab.href as '/')}
			class="tab"
			aria-current={isActive(tab.href) ? 'page' : undefined}
		>
			<span class="icon" aria-hidden="true">{tab.icon}</span>
			<span class="label">{tab.label}</span>
		</a>
	{/each}
	<a href={resolve('/upload')} class="fab" aria-label="Meme hochladen">+</a>
	{#each right as tab (tab.href)}
		<a
			href={resolve(tab.href as '/')}
			class="tab"
			aria-current={isActive(tab.href) ? 'page' : undefined}
		>
			<span class="icon" aria-hidden="true">{tab.icon}</span>
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

	.tab[aria-current='page'] {
		color: var(--text);
	}

	.tab:not([aria-current='page']) .icon {
		opacity: 0.6;
	}

	.icon {
		font-size: 19px;
		line-height: 1;
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
		font-size: 28px;
		font-weight: 700;
		line-height: 1;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
	}
</style>
