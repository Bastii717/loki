<script lang="ts">
	import { onMount } from 'svelte';
	import type { ContentType, ReportCategory } from '../server/moderation';
	import { apiErrorMessage } from '../api-error';

	let {
		contentType,
		contentId,
		onclose
	}: { contentType: ContentType; contentId: number; onclose: () => void } = $props();

	// Mirrors MAX_REPORT_TEXT in moderation.ts (the server module is not importable client-side).
	const MAX_TEXT = 500;

	const CATEGORIES: { value: ReportCategory; label: string }[] = [
		{ value: 'verletzend', label: 'Verletzend' },
		{ value: 'verstoerend', label: 'Verstörend' },
		{ value: 'falschinfo', label: 'Falschinfo & Schwurbelei' },
		{ value: 'spam', label: 'Spam' },
		{ value: 'sonstiges', label: 'Sonstiges' }
	];

	const SUCCESS = 'Danke, deine Meldung ist eingegangen.';
	const DUPLICATE = 'Du hast diesen Inhalt bereits gemeldet.';

	let dialog = $state<HTMLDialogElement>();
	let category = $state<ReportCategory | ''>('');
	let text = $state('');
	let sending = $state(false);
	let done = $state(false);
	let failure = $state('');

	onMount(() => dialog?.showModal());

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!category || sending) return;
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
				failure = 'Dieser Inhalt existiert nicht mehr.';
			} else {
				failure = await apiErrorMessage(res, 'Meldung konnte nicht gesendet werden.');
			}
		} catch {
			failure = 'Meldung konnte nicht gesendet werden.';
		} finally {
			sending = false;
		}
	}
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="report-title">
	{#if done}
		<h2 id="report-title">Gemeldet</h2>
		<p class="success" role="status">{SUCCESS}</p>
		<div class="actions">
			<button type="button" class="primary" onclick={() => dialog?.close()}>Schließen</button>
		</div>
	{:else}
		<form onsubmit={submit}>
			<h2 id="report-title">Inhalt melden</h2>
			<fieldset>
				<legend>Warum meldest du das?</legend>
				{#each CATEGORIES as c (c.value)}
					<label class="option">
						<input type="radio" name="category" value={c.value} bind:group={category} required />
						{c.label}
					</label>
				{/each}
			</fieldset>
			<label class="note">
				<span>Anmerkung (optional)</span>
				<textarea bind:value={text} maxlength={MAX_TEXT} rows="3"></textarea>
				<small aria-live="polite">{text.length} / {MAX_TEXT}</small>
			</label>
			{#if failure}<p class="error" role="alert">{failure}</p>{/if}
			<div class="actions">
				<button type="button" onclick={() => dialog?.close()}>Abbrechen</button>
				<button type="submit" class="primary" disabled={!category || sending}>Melden</button>
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

	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
