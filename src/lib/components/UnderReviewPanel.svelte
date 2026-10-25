<script lang="ts">
	import EyeOff from 'lucide-svelte/icons/eye-off';

	/** Stand-in for reported content that members may not see. Never offers a reveal. */
	let { compact = false }: { compact?: boolean } = $props();
</script>

<div class="panel" class:compact role="status">
	<EyeOff size={compact ? 22 : 32} aria-hidden="true" />
	<b>Under review</b>
	<span>This content was reported and is being reviewed by moderators.</span>
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		min-height: 220px;
		padding: 24px 16px;
		background: var(--surface-raised);
		color: var(--text-muted);
		text-align: center;
	}

	.panel.compact {
		min-height: 0;
	}

	b {
		color: var(--text);
		font-size: 1rem;
	}

	span {
		max-width: 28ch;
		font-size: 13px;
	}
</style>
