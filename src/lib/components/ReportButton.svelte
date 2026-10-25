<script lang="ts">
	import Flag from 'lucide-svelte/icons/flag';
	import type { ContentType } from '../server/moderation';
	import ReportDialog from './ReportDialog.svelte';

	/**
	 * The one entry point for reporting. `mine` is the single guard: a viewer's own content never
	 * gets a report control (the server rejects it too, with 'own').
	 */
	let {
		contentType,
		contentId,
		mine,
		variant = 'plain'
	}: {
		contentType: ContentType;
		contentId: number;
		mine: boolean;
		/** `overlay`: round button on top of media; `plain`: inline icon button. */
		variant?: 'plain' | 'overlay';
	} = $props();

	let open = $state(false);
</script>

{#if !mine}
	<button
		type="button"
		class="report {variant}"
		aria-label="Report"
		title="Report"
		onclick={() => (open = true)}
		><Flag size={variant === 'overlay' ? 18 : 16} aria-hidden="true" /></button
	>
	{#if open}
		<ReportDialog {contentType} {contentId} onclose={() => (open = false)} />
	{/if}
{/if}

<style>
	.report {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 36px;
		min-height: 36px;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		opacity: 0.7;
		cursor: pointer;
	}

	.report.overlay {
		position: absolute;
		bottom: 6px;
		right: 6px;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		opacity: 1;
	}
</style>
