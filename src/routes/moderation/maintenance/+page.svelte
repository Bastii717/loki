<script lang="ts">
	import { enhance } from '$app/forms';
	import Power from 'lucide-svelte/icons/power';
	import Save from 'lucide-svelte/icons/save';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const STATE_LABELS: Record<string, string> = {
		ok: 'Normal operation',
		announced: 'Announced (starts later)',
		maintenance: 'Maintenance active',
		not_ready: 'Starting up',
		down: 'Down'
	};

	// Inputs start from the saved switch; after a rejected save they keep what was typed.
	let enabled = $state(false);
	let message = $state('');
	let startsAt = $state('');
	let until = $state('');
	let busy = $state(false);

	$effect(() => {
		enabled = form?.error ? form.enabled : data.enabled;
		message = form?.error ? form.message : data.message;
		startsAt = form?.error ? form.startsAt : data.startsAt;
		until = form?.error ? form.until : data.until;
	});

	const submit = () => {
		busy = true;
		return async ({ update }: { update: (options?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	};
</script>

<svelte:head>
	<title>Maintenance · Moderation · Loki</title>
</svelte:head>

<section class="card" aria-labelledby="switch-title">
	<h2 id="switch-title">Maintenance mode</h2>
	<p class="muted">
		While it is on, members and moderators can read but not post, comment, vote or report. Admins
		keep full access. Times are Berlin time.
	</p>

	<form method="POST" action="?/save" use:enhance={submit}>
		<label class="toggle">
			<input type="checkbox" name="enabled" bind:checked={enabled} />
			<span>Maintenance mode is on</span>
		</label>

		<label>
			Message (optional, shown in the banner)
			<textarea
				class="field"
				name="message"
				rows="3"
				maxlength={data.maxMessage}
				bind:value={message}></textarea>
			<span class="counter" class:full={message.length >= data.maxMessage}>
				{message.length} / {data.maxMessage}
			</span>
		</label>

		<label>
			Starts (optional, announced until then)
			<input class="field" type="datetime-local" name="startsAt" bind:value={startsAt} />
		</label>

		<label>
			Ends (optional, switches off by itself)
			<input class="field" type="datetime-local" name="until" bind:value={until} />
		</label>

		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if form?.saved && !busy}<p class="ok" role="status">Saved.</p>{/if}

		<div class="actions">
			<button type="submit" class="btn primary" disabled={busy}>
				<Save size={16} aria-hidden="true" /> Save
			</button>
			<button type="submit" class="btn danger" formaction="?/off" disabled={busy}>
				<Power size={16} aria-hidden="true" /> Switch off now
			</button>
		</div>
	</form>
</section>

<section class="card" aria-labelledby="preview-title">
	<h2 id="preview-title">Preview</h2>
	<p class="muted">What the saved switch shows right now.</p>
	<p>
		<span class="pill accent">{STATE_LABELS[data.state] ?? data.state}</span>
	</p>
	<dl class="preview">
		<dt>Admins see</dt>
		<dd>{data.preview.admin ?? 'No banner.'}</dd>
		<dt>Members see</dt>
		<dd>{data.preview.member ?? 'No banner.'}</dd>
	</dl>
</section>

<style>
	h2 {
		margin: 0;
		font-size: 16px;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
	}

	.toggle {
		flex-direction: row;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		font-weight: 600;
	}

	.toggle input {
		width: 22px;
		height: 22px;
		margin: 0;
		accent-color: var(--accent);
	}

	textarea {
		resize: vertical;
	}

	.counter {
		align-self: flex-end;
		color: var(--text-muted);
		font-size: 12px;
	}

	.counter.full {
		color: var(--down);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.actions .btn {
		flex: 1 1 140px;
	}

	.preview {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		font-size: 14px;
	}

	.preview dt {
		margin-top: 6px;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
	}

	.preview dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
</style>
