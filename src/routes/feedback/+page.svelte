<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// After a failed submit without script the action echoes what was typed, so nothing is lost.
	// svelte-ignore state_referenced_locally
	let message = $state(form?.error ? (form.message ?? '') : '');
	// svelte-ignore state_referenced_locally
	let anonymous = $state(form?.error ? (form.anonymous ?? false) : false);
	let submitting = $state(false);
	let sent = $state(false);
	// Without JS the textarea cannot enable the button, so it is only ever disabled once hydrated;
	// the server validates the message either way.
	let hydrated = $state(false);
	onMount(() => (hydrated = true));

	const empty = $derived(message.trim() === '');
</script>

<svelte:head>
	<title>Feedback · Loki</title>
</svelte:head>

<main>
	<a class="back" href={resolve('/profile')}><ArrowLeft size={16} aria-hidden="true" /> Profile</a>

	<header>
		<h1><MessageCircle size={22} aria-hidden="true" /> Feedback</h1>
		<p class="sub">
			Tell the admins what's on your mind — ideas, gripes, praise. It lands straight in their inbox.
		</p>
	</header>

	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			sent = false;
			return async ({ result, update }) => {
				if (result.type === 'success') {
					message = '';
					anonymous = false;
					sent = true;
				}
				// a failure keeps the typed message and the checkbox as they are
				await update({ reset: result.type === 'success' });
				submitting = false;
			};
		}}
	>
		<label class="field">
			<span class="label">What should we know?</span>
			<textarea
				name="message"
				rows="8"
				maxlength={data.maxLength}
				bind:value={message}
				oninput={() => (sent = false)}></textarea>
			<span class="count" aria-live="off">{message.length} / {data.maxLength}</span>
		</label>

		<label class="check">
			<input type="checkbox" name="anonymous" bind:checked={anonymous} />
			<span>
				<span class="check-label">Send anonymously</span>
				<span class="hint">
					Your name stays out of the email — but then nobody can get back to you about it.
				</span>
			</span>
		</label>

		{#if form?.error}
			<p class="error" role="alert">{form.error}</p>
		{:else if hydrated ? sent : form?.sent}
			<!-- hydrated: local state only, so typing the next message hides it; no JS: the action result -->

			<p class="thanks" role="status">Thanks! Your feedback is on its way.</p>
		{/if}

		<button type="submit" disabled={hydrated && (empty || submitting)}>Send feedback</button>
	</form>
</main>

<style>
	main {
		max-width: 560px;
		margin: 0 auto;
		padding: 12px var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}
	.back {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 40px;
		color: var(--text-muted);
		font-size: 13px;
		text-decoration: none;
	}
	header {
		margin: 4px 0 16px;
	}
	h1 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 22px;
	}
	.sub {
		margin: 6px 0 0;
		font-size: 13px;
		line-height: 1.45;
		color: var(--text-muted);
	}
	form {
		display: grid;
		gap: 14px;
	}
	.field {
		display: grid;
		gap: 6px;
	}
	.label {
		font-size: 13px;
		font-weight: 600;
	}
	textarea {
		width: 100%;
		min-height: 160px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-raised);
		color: var(--text);
		font: inherit;
		line-height: 1.45;
		resize: vertical;
	}
	.count {
		justify-self: end;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}
	.check {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		cursor: pointer;
	}
	.check input {
		flex: 0 0 auto;
		width: 18px;
		height: 18px;
		margin: 1px 0 0;
		accent-color: var(--accent);
	}
	.check-label {
		display: block;
		font-size: 14px;
	}
	.hint {
		display: block;
		margin-top: 2px;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-muted);
	}
	.error,
	.thanks {
		margin: 0;
		font-size: 13px;
	}
	.error {
		color: var(--down);
	}
	.thanks {
		color: var(--up);
	}
	button {
		width: 100%;
		height: 44px;
		border: 0;
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--accent-text);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}
	button:disabled {
		background: var(--surface-raised);
		color: var(--text-muted);
		cursor: not-allowed;
	}
</style>
