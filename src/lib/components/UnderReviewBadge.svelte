<script lang="ts">
	import EyeOff from 'lucide-svelte/icons/eye-off';

	/** Moderator-only hint: this content is hidden from members right now. */
	let { overlay = false }: { overlay?: boolean } = $props();
</script>

<span class="badge" class:overlay title="Für Mitglieder ausgeblendet">
	<EyeOff size={12} aria-hidden="true" /> Wird geprüft
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

	.badge.overlay {
		position: absolute;
		bottom: 8px;
		left: 8px;
		background: rgba(0, 0, 0, 0.65);
		color: #fff;
		pointer-events: none;
	}
</style>
