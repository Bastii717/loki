<script lang="ts">
	import { resolve } from '$app/paths';
	import Trophy from 'lucide-svelte/icons/trophy';
	import { formatMonthLong, formatMonthYear } from '../moderation-labels';

	/** One chip per Meme of the Month win, each linking to its month on the awards page. */
	let { awards }: { awards: { month: string }[] } = $props();
</script>

{#if awards.length > 0}
	<p class="chips">
		{#each awards as award (award.month)}
			<a
				class="chip"
				href="{resolve('/awards')}?from={award.month}#{award.month}"
				aria-label="Meme of the Month, {formatMonthLong(award.month)}"
				><Trophy size={12} aria-hidden="true" /> {formatMonthYear(award.month)}</a
			>
		{/each}
	</p>
{/if}

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px;
		margin: -4px 0 16px;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 28px;
		padding: 0 10px;
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent-soft-text);
		font-size: 12px;
		font-weight: 600;
	}
</style>
