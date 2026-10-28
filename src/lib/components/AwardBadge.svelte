<script lang="ts">
	import Trophy from 'lucide-svelte/icons/trophy';
	import { formatMonthLong, formatMonthYear } from '../moderation-labels';

	/** The Meme of the Month trophy; `month` is `YYYY-MM`. */
	let { month }: { month: string } = $props();
	const long = $derived(`Meme of the Month, ${formatMonthLong(month)}`);
</script>

<span class="badge" title={long} aria-label={long}>
	<Trophy size={12} aria-hidden="true" /> Meme of the Month · {formatMonthYear(month)}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent-soft-text);
		font-size: 11px;
		font-weight: 600;
		white-space: nowrap;
	}
</style>
