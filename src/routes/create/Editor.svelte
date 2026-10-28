<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { CAPTION_MAX, drawMeme, outputSize, renderBlob } from '../../lib/meme-canvas';
	import type { ActionData } from './$types';
	import type { EditorSource } from './+page.server';

	// The page mounts this component fresh for every source (keyed block), so all state starts clean.
	let {
		source,
		form,
		top = $bindable('')
	}: { source: EditorSource; form: ActionData; top?: string } = $props();

	const TITLE_MAX = 120;
	/** The font may never arrive (blocked, offline): the editor works with the fallback after this long. */
	const FONT_TIMEOUT_MS = 2000;

	let canvas: HTMLCanvasElement | undefined = $state();
	let bottom = $state('');
	let uppercase = $state(true);
	let imageReady = $state(false);
	let fontReady = $state(false);
	/** Bumped whenever the browser finishes loading a font, so a late Anton replaces the fallback. */
	let fontTick = $state(0);
	let rendering = $state(false);
	let renderError = $state('');
	/** Set from the loaded image only; before that the canvas keeps the CSS aspect-ratio placeholder. */
	let size: { width: number; height: number } | null = $state(null);

	// a detached image: its natural size is what the output size is derived from
	let image: HTMLImageElement | undefined;

	const ready = $derived(imageReady && fontReady);
	const title = $derived(top.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX));

	onMount(() => {
		const img = new Image();
		img.onload = () => {
			size = outputSize(img.naturalWidth, img.naturalHeight);
			image = img;
			imageReady = true;
		};
		img.onerror = () => (renderError = 'The image could not be loaded.');
		img.src = source.url;

		let alive = true;
		const timeout = new Promise<void>((done) => setTimeout(done, FONT_TIMEOUT_MS));
		const font = document.fonts
			? document.fonts.load('40px Anton').then(
					() => undefined,
					() => undefined
				)
			: Promise.resolve();
		void Promise.race([font, timeout]).then(() => {
			if (alive) fontReady = true;
		});

		// a font (or a lazily loaded subset of it) can arrive after the first draw: draw again
		const onFontsLoaded = () => fontTick++;
		document.fonts?.addEventListener('loadingdone', onFontsLoaded);

		return () => {
			alive = false;
			document.fonts?.removeEventListener('loadingdone', onFontsLoaded);
			img.onload = null;
			img.onerror = null;
		};
	});

	// first draw when the image has loaded; every change of text, case or font ready redraws
	$effect(() => {
		const opts = { top, bottom, uppercase };
		void fontReady;
		void fontTick;
		if (!imageReady || !image || !canvas) return;
		drawMeme(canvas, image, opts);
	});
</script>

<div class="preview">
	<!-- a canvas is not a native image: role="img" makes screen readers announce the label -->
	<!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
	<canvas
		bind:this={canvas}
		width={size?.width}
		height={size?.height}
		style:aspect-ratio="{source.width} / {source.height}"
		role="img"
		aria-label="Preview of {source.name}"
	></canvas>
</div>

<form
	method="POST"
	action="?/stash"
	enctype="multipart/form-data"
	use:enhance={async ({ formData, cancel }) => {
		if (!canvas || !ready) {
			cancel();
			return;
		}
		rendering = true;
		renderError = '';
		try {
			formData.set('file', await renderBlob(canvas), 'meme.png');
		} catch {
			renderError = 'Could not render the meme.';
			rendering = false;
			cancel();
			return;
		}
		return async ({ update }) => {
			await update({ reset: false });
			rendering = false;
		};
	}}
>
	{#if renderError || form?.error}
		<p class="error" role="alert">{renderError || form?.error}</p>
	{/if}

	<label class="field">
		<span>Top text</span>
		<textarea name="top" maxlength={CAPTION_MAX} rows="2" bind:value={top}></textarea>
		<span class="count">{top.length}/{CAPTION_MAX}</span>
	</label>

	<label class="field">
		<span>Bottom text</span>
		<textarea name="bottom" maxlength={CAPTION_MAX} rows="2" bind:value={bottom}></textarea>
		<span class="count">{bottom.length}/{CAPTION_MAX}</span>
	</label>

	<label class="toggle">
		<input type="checkbox" name="uppercase" bind:checked={uppercase} />
		<span>UPPERCASE</span>
	</label>

	{#if source.kind === 'template'}
		<input type="hidden" name="templateId" value={source.id} />
	{:else}
		<input type="hidden" name="sourceMemeId" value={source.id} />
	{/if}
	<input type="hidden" name="title" value={title} />

	<div class="bar">
		<button type="submit" class="post" disabled={!ready || rendering}>Post it</button>
	</div>
</form>

<style>
	.preview {
		--preview-max: 60vh;
		display: flex;
		justify-content: center;
		max-height: var(--preview-max);
		background: var(--bg);
	}

	/*
	 * While a field has focus (phone keyboard open) the preview pins under the sticky header and
	 * shrinks, so it stays in view next to the field. The canvas keeps its internal resolution.
	 * 56px is the header height set in +page.svelte.
	 */
	:global(main.editor:focus-within) .preview {
		--preview-max: 35vh;
		position: sticky;
		top: calc(var(--banners-height, 0px) + 56px);
		z-index: 4;
		padding-bottom: 6px;
	}

	@supports (height: 1svh) {
		:global(main.editor:focus-within) .preview {
			--preview-max: 35svh;
		}
	}

	canvas {
		display: block;
		/* tall templates are letterboxed so the fields stay reachable while typing */
		width: auto;
		max-width: 100%;
		height: auto;
		max-height: var(--preview-max);
		border-radius: var(--radius);
		background: var(--surface);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin: 0;
	}

	.error {
		margin: 0;
		padding: 12px;
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--down) 18%, transparent);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 14px;
		font-weight: 600;
	}

	textarea {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-weight: 400;
		resize: vertical;
	}

	.count {
		align-self: flex-end;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 400;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		font-size: 14px;
	}

	.bar {
		position: sticky;
		bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom));
		z-index: 4;
		padding: 10px 0;
		background: var(--bg);
	}

	.post {
		width: 100%;
		min-height: 48px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: var(--accent-text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.post:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
