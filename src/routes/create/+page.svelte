<script lang="ts">
	import '@fontsource/anton';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { CAPTION_MAX, drawMeme, outputSize, renderBlob } from '../../lib/meme-canvas';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const TITLE_MAX = 120;
	/** The font may never arrive (blocked, offline): the editor works with the fallback after this long. */
	const FONT_TIMEOUT_MS = 2000;

	const source = $derived(data.mode === 'grid' ? null : data.source);
	const size = $derived(source ? outputSize(source.width, source.height) : null);

	let canvas: HTMLCanvasElement | undefined = $state();
	let top = $state('');
	let bottom = $state('');
	let uppercase = $state(true);
	let imageReady = $state(false);
	let fontReady = $state(false);
	let rendering = $state(false);
	let renderError = $state('');

	// a detached image: its width and height are the natural size, whatever the layout does
	let image: HTMLImageElement | undefined;

	const ready = $derived(imageReady && fontReady);
	const title = $derived(top.trim().slice(0, TITLE_MAX));

	onMount(() => {
		if (!source) return;
		const img = new Image();
		img.onload = () => {
			image = img;
			imageReady = true;
		};
		img.onerror = () => (renderError = 'The image could not be loaded.');
		img.src = source.url;

		const timeout = new Promise<void>((done) => setTimeout(done, FONT_TIMEOUT_MS));
		const font = document.fonts
			? document.fonts.load('40px Anton').then(
					() => undefined,
					() => undefined
				)
			: Promise.resolve();
		void Promise.race([font, timeout]).then(() => (fontReady = true));
	});

	// first draw when the image has loaded; every change of text, case or font ready redraws
	$effect(() => {
		const opts = { top, bottom, uppercase };
		void fontReady;
		if (!imageReady || !image || !canvas) return;
		drawMeme(canvas, image, opts);
	});
</script>

<svelte:head>
	<title>Make a meme · Loki</title>
</svelte:head>

{#if data.mode === 'grid'}
	<header class="top">
		<h1>Pick a template</h1>
	</header>

	<main>
		{#if data.templates.length === 0}
			<p class="empty">No templates yet. Admins add them under Moderation → Templates.</p>
		{:else}
			<ul class="grid">
				{#each data.templates as template (template.id)}
					<li>
						<a href="{resolve('/create')}?template={template.id}" class="card">
							<img
								src="/api/templates/{template.id}/thumb"
								alt=""
								width={template.width}
								height={template.height}
								loading="lazy"
							/>
							<span class="name">{template.name}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="hint">Or open any meme and tap Remix.</p>
	</main>
{:else if source && size}
	<header class="top">
		<h1>Make a meme</h1>
		<a href={resolve('/create')} class="change">Change template</a>
	</header>

	<main class="editor">
		<canvas
			bind:this={canvas}
			width={size.width}
			height={size.height}
			aria-label="Preview of {source.name}"
		></canvas>

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
			{/if}
			<input type="hidden" name="title" value={title} />

			<div class="bar">
				<button type="submit" class="post" disabled={!ready || rendering}>Post it</button>
			</div>
		</form>
	</main>
{/if}

<style>
	.top {
		position: sticky;
		/* below the status banner strip, when there is one */
		top: var(--banners-height, 0px);
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		max-width: 560px;
		margin: 0 auto;
		padding: 6px var(--gutter);
		background: var(--bg);
	}

	h1 {
		margin: 0;
		font-size: 18px;
	}

	.change {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		color: var(--accent-soft-text);
		font-size: 14px;
		font-weight: 600;
	}

	main {
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 560px;
		margin: 0 auto;
		padding: 4px var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	@media (min-width: 560px) {
		.grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}

	.card {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
	}

	.card img {
		display: block;
		width: 100%;
		height: auto;
		aspect-ratio: 1;
		object-fit: cover;
		background: var(--surface-raised);
	}

	.name {
		padding: 8px 10px;
		font-size: 14px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.empty {
		margin: 24px 0;
		color: var(--text-muted);
		text-align: center;
	}

	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: 14px;
		text-align: center;
	}

	canvas {
		display: block;
		width: 100%;
		height: auto;
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
