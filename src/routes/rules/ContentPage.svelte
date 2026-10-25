<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Save from 'lucide-svelte/icons/save';
	import X from 'lucide-svelte/icons/x';
	import { lockMessage, useStatus } from '../../lib/status-context';

	let {
		title,
		data,
		form
	}: {
		title: string;
		data: { html: string; markdown: string | null; canEdit: boolean };
		form: { error?: string; markdown?: string; saved?: boolean } | null;
	} = $props();

	let editing = $state(false);
	// The textarea is reset to the saved markdown every time the editor opens, so a rejected
	// draft (still echoed in `form`) never resurfaces after cancelling.
	let draft = $state('');
	let submitted = $state(false);

	// While writes are locked the save stays in the DOM (focusable, with the reason as title);
	// saving shows the reason in the error line instead of posting.
	const status = useStatus();
	const locked = $derived(!status.value.writable);
	let lockNote = $state('');

	function openEditor() {
		draft = data.markdown ?? '';
		submitted = false;
		lockNote = '';
		editing = true;
	}
</script>

<svelte:head>
	<title>{title} · Loki</title>
</svelte:head>

<!-- Reached from the profile, so the header matches the other profile sub pages. -->
<header class="top">
	<a href={resolve('/profile')} class="back" aria-label="Back to profile"><ArrowLeft size={22} /></a
	>
	<h1>{title}</h1>
	{#if data.canEdit && !editing}
		<button type="button" class="edit" onclick={openEditor}>
			<Pencil size={16} aria-hidden="true" /> Edit
		</button>
	{/if}
</header>

<main>
	{#if editing}
		<form
			method="POST"
			action="?/save"
			use:enhance={({ cancel }) => {
				lockNote = locked ? lockMessage(status.value) : '';
				if (locked) {
					cancel();
					return;
				}
				submitted = true;
				return async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') editing = false;
				};
			}}
		>
			<label class="sr-only" for="markdown">{title} (Markdown)</label>
			<textarea id="markdown" name="markdown" rows="16" bind:value={draft}></textarea>
			{#if lockNote}
				<p class="error" role="alert">{lockNote}</p>
			{:else if submitted && form?.error}
				<p class="error" role="alert">{form.error}</p>
			{/if}
			<div class="actions">
				<button
					type="submit"
					class="primary"
					aria-disabled={locked ? 'true' : undefined}
					title={locked ? lockMessage(status.value) : undefined}
				>
					<Save size={16} aria-hidden="true" /> Save
				</button>
				<button type="button" onclick={() => (editing = false)}>
					<X size={16} aria-hidden="true" /> Cancel
				</button>
			</div>
		</form>
	{:else if data.html}
		<!-- Safe: sanitized with DOMPurify on the server (see content.ts). -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<article class="prose">{@html data.html}</article>
	{:else}
		<p class="empty">Nothing here yet — an admin can add content.</p>
	{/if}
</main>

<style>
	.top {
		position: sticky;
		/* below the status banner strip, when there is one */
		top: var(--banners-height, 0px);
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 8px;
		background: var(--bg);
	}
	.back {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 44px;
		height: 44px;
	}
	h1 {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: 18px;
	}
	.edit {
		margin-right: 2px;
	}
	main {
		padding: 0 var(--gutter) calc(var(--tabbar-height) + var(--gutter));
		max-width: 44rem;
		margin: 0 auto;
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 40px;
		padding: 0 0.9rem;
		border-radius: var(--radius-pill);
		border: 1px solid var(--border);
		font: inherit;
		color: var(--text);
		background: var(--surface);
		cursor: pointer;
	}
	button[aria-disabled='true'] {
		opacity: 0.5;
	}
	button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-text);
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.75rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.9rem;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		resize: vertical;
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.error {
		color: var(--down);
	}
	.empty {
		color: var(--text-muted);
	}
	.prose {
		background: var(--surface);
		border-radius: var(--radius);
		padding: 0.75rem 1rem;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
	.prose :global(h1),
	.prose :global(h2),
	.prose :global(h3) {
		margin: 1rem 0 0.5rem;
		line-height: 1.25;
	}
	.prose :global(a) {
		color: var(--accent-soft-text);
	}
	.prose :global(p),
	.prose :global(ul),
	.prose :global(ol) {
		margin: 0.5rem 0;
	}
	.prose :global(code) {
		background: var(--surface-raised);
		padding: 0.1rem 0.3rem;
		border-radius: 4px;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
