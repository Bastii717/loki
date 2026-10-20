<script lang="ts">
	import { enhance } from '$app/forms';
	import X from 'lucide-svelte/icons/x';
	import { onMount } from 'svelte';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	const TAG_PATTERN = /^[a-z0-9äöüß-]{2,30}$/;
	const MAX_TAGS = 10;

	let fileInput: HTMLInputElement | undefined = $state();
	let previewUrl: string | null = $state(null);
	let previewKind: 'image' | 'video' | null = $state(null);
	let fileName = $state('');
	let dragging = $state(false);
	let submitting = $state(false);

	let title = $state('');
	let nsfw = $state(false);
	let spoiler = $state(false);

	let tags: string[] = $state([]);
	let tagInput = $state('');
	let suggestions: string[] = $state([]);
	let suggestTimer: ReturnType<typeof setTimeout> | undefined;
	let suggestSeq = 0;

	function setPreview(file: File | undefined) {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		if (!file) {
			previewUrl = null;
			previewKind = null;
			fileName = '';
			return;
		}
		previewUrl = URL.createObjectURL(file);
		previewKind = file.type.startsWith('video/') ? 'video' : 'image';
		fileName = file.name;
	}

	/** Puts a file into the real input so it is submitted with the form. */
	function takeFile(file: File | undefined) {
		if (!file || !fileInput) return;
		if (!/^(image|video)\//.test(file.type)) return;
		const transfer = new DataTransfer();
		transfer.items.add(file);
		fileInput.files = transfer.files;
		setPreview(file);
	}

	// file handed over by the PWA share target (stashed server-side for two minutes)
	onMount(async () => {
		if (!data.hasShared) return;
		try {
			const res = await fetch('/share/file');
			if (!res.ok) return;
			const blob = await res.blob();
			const name = decodeURIComponent(res.headers.get('x-shared-name') ?? 'geteilt');
			takeFile(new File([blob], name, { type: blob.type }));
		} catch {
			// the user can still pick the file manually
		}
	});

	function onPaste(e: ClipboardEvent) {
		const file = [...(e.clipboardData?.files ?? [])].find((f) => /^(image|video)\//.test(f.type));
		if (file) {
			e.preventDefault();
			takeFile(file);
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		takeFile(e.dataTransfer?.files[0]);
	}

	/** Commits `raw` as a chip; returns the tag when it was newly added. */
	function addTag(raw: string): string | undefined {
		const tag = raw.trim().toLowerCase().replace(/^#/, '');
		const added = TAG_PATTERN.test(tag) && !tags.includes(tag) && tags.length < MAX_TAGS;
		if (added) tags.push(tag);
		tagInput = '';
		suggestions = [];
		return added ? tag : undefined;
	}

	function onTagKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
			if (tagInput.trim()) {
				e.preventDefault();
				addTag(tagInput);
			} else if (e.key === 'Enter') {
				e.preventDefault();
			}
		} else if (e.key === 'Backspace' && tagInput === '') {
			tags.pop();
		}
	}

	function onTagInput() {
		clearTimeout(suggestTimer);
		// mobile keyboards often report key "Unidentified", so also commit on the typed separator
		if (/[\s,]$/.test(tagInput) && tagInput.trim()) {
			addTag(tagInput.replace(/[\s,]+$/, ''));
			return;
		}
		const q = tagInput.trim().replace(/^#/, '');
		if (q === '') {
			suggestions = [];
			return;
		}
		suggestTimer = setTimeout(async () => {
			const seq = ++suggestSeq;
			try {
				const res = await fetch(`/api/tags/suggest?q=${encodeURIComponent(q)}`);
				if (!res.ok || seq !== suggestSeq) return;
				const data: { tags: string[] } = await res.json();
				suggestions = data.tags.filter((t) => !tags.includes(t));
			} catch {
				suggestions = [];
			}
		}, 150);
	}
</script>

<svelte:window onpaste={onPaste} />

<main>
	<h1>Meme posten</h1>

	<form
		method="POST"
		enctype="multipart/form-data"
		use:enhance={({ formData }) => {
			// FormData is built before this callback runs, so a still-pending tag must be appended here
			const pending = tagInput.trim() ? addTag(tagInput) : undefined;
			if (pending) formData.append('tag', pending);
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		{#if form?.message}
			<p class="error" role="alert">{form.message}</p>
		{/if}

		<label
			class="drop"
			class:dragging
			ondragover={(e) => {
				e.preventDefault();
				dragging = true;
			}}
			ondragleave={() => (dragging = false)}
			ondrop={onDrop}
		>
			{#if previewUrl && previewKind === 'video'}
				<video src={previewUrl} controls muted playsinline></video>
			{:else if previewUrl}
				<img src={previewUrl} alt="Vorschau" />
			{:else}
				<span>Bild oder Video wählen, hierher ziehen oder einfügen</span>
			{/if}
			<input
				bind:this={fileInput}
				type="file"
				name="file"
				accept="image/*,video/*"
				required
				onchange={() => setPreview(fileInput?.files?.[0])}
			/>
		</label>
		{#if fileName}<p class="hint">{fileName}</p>{/if}

		<label class="field">
			<span>Titel</span>
			<input type="text" name="title" maxlength="150" bind:value={title} placeholder="Optional" />
		</label>

		<div class="field">
			<label for="tag-input">Tags</label>
			<div class="chips">
				{#each tags as tag (tag)}
					<span class="chip">
						#{tag}
						<input type="hidden" name="tag" value={tag} />
						<button
							type="button"
							aria-label="Tag {tag} entfernen"
							onclick={() => (tags = tags.filter((t) => t !== tag))}
							><X size={14} aria-hidden="true" /></button
						>
					</span>
				{/each}
				<input
					id="tag-input"
					type="text"
					autocomplete="off"
					autocapitalize="none"
					enterkeyhint="done"
					placeholder={tags.length ? '' : 'z. B. montag'}
					bind:value={tagInput}
					oninput={onTagInput}
					onkeydown={onTagKey}
				/>
			</div>
			{#if suggestions.length}
				<ul class="suggestions">
					{#each suggestions as s (s)}
						<li><button type="button" onclick={() => addTag(s)}>#{s}</button></li>
					{/each}
				</ul>
			{/if}
		</div>

		<label class="toggle">
			<input type="checkbox" name="nsfw" bind:checked={nsfw} />
			<span>NSFW</span>
		</label>
		<label class="toggle">
			<input type="checkbox" name="spoiler" bind:checked={spoiler} />
			<span>Spoiler</span>
		</label>

		<button class="submit" type="submit" disabled={submitting}>
			{submitting ? 'Wird gepostet …' : 'Posten'}
		</button>
	</form>
</main>

<style>
	main {
		max-width: 32rem;
		margin: 0 auto;
		padding: 1rem;
	}
	h1 {
		font-size: 1.25rem;
		margin: 0 0 1rem;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.error {
		margin: 0;
		padding: 0.75rem;
		border-radius: 0.5rem;
		background: color-mix(in srgb, crimson 25%, transparent);
	}
	.hint {
		margin: -0.5rem 0 0;
		font-size: 0.8rem;
		opacity: 0.7;
		overflow-wrap: anywhere;
	}
	.drop {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 12rem;
		padding: 0.5rem;
		border: 2px dashed color-mix(in srgb, currentColor 40%, transparent);
		border-radius: 0.75rem;
		text-align: center;
		cursor: pointer;
		overflow: hidden;
	}
	.drop.dragging {
		border-color: currentColor;
	}
	.drop img,
	.drop video {
		max-width: 100%;
		max-height: 60vh;
		border-radius: 0.5rem;
	}
	/* the real input stays in the DOM (form submission, required, camera) but is covered by the label */
	.drop input[type='file'] {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
		width: 100%;
		height: 100%;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	input[type='text'] {
		font: inherit;
		padding: 0.65rem;
		border-radius: 0.5rem;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		background: transparent;
		color: inherit;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		padding: 0.4rem;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		border-radius: 0.5rem;
	}
	.chips input[type='text'] {
		flex: 1;
		min-width: 6rem;
		border: 0;
		padding: 0.3rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.3rem 0.2rem 0.6rem;
		border-radius: 999px;
		background: color-mix(in srgb, currentColor 15%, transparent);
	}
	.chip button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font: inherit;
		border: 0;
		background: none;
		color: inherit;
		min-width: 1.75rem;
		min-height: 1.75rem;
		cursor: pointer;
	}
	.suggestions {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.suggestions button {
		font: inherit;
		padding: 0.4rem 0.7rem;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
		background: none;
		color: inherit;
		cursor: pointer;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 2.75rem;
	}
	.toggle input {
		width: 1.25rem;
		height: 1.25rem;
	}
	.submit {
		font: inherit;
		font-weight: 600;
		min-height: 3rem;
		border: 0;
		border-radius: 0.6rem;
		background: #6d5efc;
		color: white;
		cursor: pointer;
	}
	.submit:disabled {
		opacity: 0.6;
	}
</style>
