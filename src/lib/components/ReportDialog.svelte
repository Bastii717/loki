<script lang="ts">
	import { onMount } from 'svelte';
	import type { ContentType, ReportCategory } from '../server/moderation';
	import { apiErrorMessage } from '../api-error';
	import { lockMessage, useStatus } from '../status-context';

	let {
		contentType,
		contentId,
		onclose
	}: { contentType: ContentType; contentId: number; onclose: () => void } = $props();

	// Mirrors MAX_REPORT_TEXT in moderation.ts (the server module is not importable client-side).
	const MAX_TEXT = 500;

	const CATEGORIES: { value: ReportCategory; label: string }[] = [
		{ value: 'hurtful', label: 'Hurtful' },
		{ value: 'disturbing', label: 'Disturbing' },
		{ value: 'misinformation', label: 'Misinformation & nonsense' },
		{ value: 'spam', label: 'Spam' },
		{ value: 'other', label: 'Other' }
	];

	const SUCCESS = 'Thanks, your report has been received.';
	const DUPLICATE = 'You have already reported this content.';

	let dialog = $state<HTMLDialogElement>();
	let category = $state<ReportCategory | ''>('');
	let text = $state('');
	let sending = $state(false);
	let done = $state(false);
	let failure = $state('');

	// While writes are locked the reason is shown as soon as the dialog opens, and sending is off.
	const status = useStatus();
	const locked = $derived(!status.value.writable);
	const shownError = $derived(failure || (locked ? lockMessage(status.value) : ''));

	onMount(() => dialog?.showModal());

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!category || sending || locked) return;
		sending = true;
		failure = '';
		try {
			const res = await fetch('/api/report', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ contentType, contentId, category, text: text.trim() })
			});
			if (res.ok) {
				done = true;
			} else if (res.status === 409) {
				failure = DUPLICATE;
			} else if (res.status === 404) {
				failure = 'This content no longer exists.';
			} else {
				failure = await apiErrorMessage(res, 'Could not send the report.');
			}
		} catch {
			failure = 'Could not send the report.';
		} finally {
			sending = false;
		}
	}
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="report-title">
	{#if done}
		<h2 id="report-title">Reported</h2>
		<p class="success" role="status">{SUCCESS}</p>
		<div class="actions">
			<button type="button" class="primary" onclick={() => dialog?.close()}>Close</button>
		</div>
	{:else}
		<form onsubmit={submit}>
			<h2 id="report-title">Report content</h2>
			<fieldset>
				<legend>Why are you reporting this?</legend>
				{#each CATEGORIES as c (c.value)}
					<label class="option">
						<input type="radio" name="category" value={c.value} bind:group={category} required />
						{c.label}
					</label>
				{/each}
			</fieldset>
			<label class="note">
				<span>Note (optional)</span>
				<textarea bind:value={text} maxlength={MAX_TEXT} rows="3"></textarea>
				<small aria-live="polite">{text.length} / {MAX_TEXT}</small>
			</label>
			{#if shownError}<p class="error" role="alert">{shownError}</p>{/if}
			<div class="actions">
				<button type="button" onclick={() => dialog?.close()}>Cancel</button>
				<button
					type="submit"
					class="primary"
					disabled={!category || sending}
					aria-disabled={locked ? 'true' : undefined}
					title={locked ? lockMessage(status.value) : undefined}>Report</button
				>
			</div>
		</form>
	{/if}
</dialog>

<style>
	dialog {
		width: min(420px, calc(100vw - 2 * var(--gutter)));
		padding: 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-raised);
		color: var(--text);
	}

	dialog::backdrop {
		background: var(--overlay);
	}

	h2 {
		margin: 0 0 10px;
		font-size: 17px;
	}

	fieldset {
		margin: 0 0 12px;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: 4px;
		color: var(--text-muted);
		font-size: 13px;
	}

	.option {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		cursor: pointer;
	}

	.note {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
	}

	.note small {
		align-self: flex-end;
		color: var(--text-muted);
	}

	textarea {
		resize: none;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}

	.error {
		margin: 8px 0 0;
		color: var(--down);
		font-size: 13px;
	}

	.success {
		margin: 0 0 12px;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}

	.actions button {
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.actions .primary {
		border-color: transparent;
		background: var(--accent);
		color: var(--accent-text);
	}

	.actions button[aria-disabled='true'],
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
