<script lang="ts">
	import Hourglass from 'lucide-svelte/icons/hourglass';
	import Megaphone from 'lucide-svelte/icons/megaphone';
	import Wrench from 'lucide-svelte/icons/wrench';
	import type { AppState } from '../server/maintenance';

	let { state, message }: { state: AppState; message: string | null } = $props();
</script>

{#if message && (state === 'announced' || state === 'maintenance' || state === 'not_ready')}
	<div
		class="banner"
		class:down={state === 'not_ready'}
		role={state === 'announced' ? 'status' : 'alert'}
	>
		{#if state === 'maintenance'}
			<Wrench size={18} aria-hidden="true" />
		{:else if state === 'announced'}
			<Megaphone size={18} aria-hidden="true" />
		{:else}
			<Hourglass size={18} aria-hidden="true" />
		{/if}
		<p>{message}</p>
	</div>
{/if}

<style>
	.banner {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 8px var(--gutter);
		font-size: 0.85rem;
		line-height: 1.35;
		color: var(--text);
		background: var(--surface-raised);
		border-bottom: 2px solid var(--accent);
	}

	.banner.down {
		border-bottom-color: var(--down);
	}

	.banner :global(svg) {
		flex: none;
		margin-top: 1px;
		color: var(--accent);
	}

	.banner.down :global(svg) {
		color: var(--down);
	}

	p {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
