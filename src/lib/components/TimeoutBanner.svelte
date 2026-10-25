<script lang="ts">
	import Clock from 'lucide-svelte/icons/clock';
	import { formatDate } from '../moderation-labels';

	let { until, reason }: { until: string; reason: string } = $props();
</script>

<div class="banner" role="alert">
	<Clock size={18} aria-hidden="true" />
	<p>You are muted until {formatDate(until)}: {reason}</p>
</div>

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
		border-bottom: 2px solid var(--down);
	}

	.banner :global(svg) {
		flex: none;
		margin-top: 1px;
		color: var(--down);
	}

	p {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
