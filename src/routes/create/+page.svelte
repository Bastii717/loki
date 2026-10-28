<script lang="ts">
	import '@fontsource/anton';
	import { resolve } from '$app/paths';
	import type { ActionData, PageData } from './$types';
	import Editor from './Editor.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
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
{:else}
	<header class="top">
		<h1>Make a meme</h1>
		<a href={resolve('/create')} class="change">Change template</a>
	</header>

	<main class="editor">
		<!-- the page component is reused when only the query changes: remount the editor per source -->
		{#key data.source.url}
			<Editor source={data.source} {form} />
		{/key}
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
		box-sizing: border-box;
		/* the editor pins its preview right below this height (56px in Editor.svelte) */
		min-height: 56px;
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

	/*
	 * A focused textarea stays clear of the sticky Post bar (the tab bar sits behind the keyboard)
	 * and of the pinned header and preview above it.
	 */
	:global(html:has(main.editor)) {
		scroll-padding-bottom: 72px;
		scroll-padding-top: calc(var(--banners-height, 0px) + 56px + 35vh + 12px);
	}

	@supports (height: 1svh) {
		:global(html:has(main.editor)) {
			scroll-padding-top: calc(var(--banners-height, 0px) + 56px + 35svh + 12px);
		}
	}
</style>
