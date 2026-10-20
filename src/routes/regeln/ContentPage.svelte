<script lang="ts">
	import { enhance } from '$app/forms';
	import Pencil from 'lucide-svelte/icons/pencil';
	import Save from 'lucide-svelte/icons/save';
	import X from 'lucide-svelte/icons/x';

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
</script>

<svelte:head>
	<title>{title} · Loki</title>
</svelte:head>

<main>
	<header>
		<h1>{title}</h1>
		{#if data.canEdit && !editing}
			<button type="button" onclick={() => (editing = true)}>
				<Pencil size={16} aria-hidden="true" /> Bearbeiten
			</button>
		{/if}
	</header>

	{#if editing}
		<form
			method="POST"
			action="?/save"
			use:enhance={() =>
				async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'success') editing = false;
				}}
		>
			<label class="sr-only" for="markdown">{title} (Markdown)</label>
			<textarea
				id="markdown"
				name="markdown"
				rows="16"
				value={form?.markdown ?? data.markdown ?? ''}></textarea>
			{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
			<div class="actions">
				<button type="submit" class="primary">
					<Save size={16} aria-hidden="true" /> Speichern
				</button>
				<button type="button" onclick={() => (editing = false)}>
					<X size={16} aria-hidden="true" /> Abbrechen
				</button>
			</div>
		</form>
	{:else if data.html}
		<!-- Safe: sanitized with DOMPurify on the server (see content.ts). -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<article class="prose">{@html data.html}</article>
	{:else}
		<p class="empty">Noch keine Inhalte — ein Admin kann sie anlegen.</p>
	{/if}
</main>

<style>
	main {
		padding: var(--gutter);
		padding-bottom: calc(var(--tabbar-height) + var(--gutter));
		max-width: 44rem;
		margin: 0 auto;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	h1 {
		margin: 0;
		font-size: 1.4rem;
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
