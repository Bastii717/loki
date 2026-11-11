<script lang="ts">
	import { enhance } from '$app/forms';
	import Info from 'lucide-svelte/icons/info';
	import Shield from 'lucide-svelte/icons/shield';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let agreed = $state(false);
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Welcome to Loki</title>
</svelte:head>

<header class="top">
	<h1>Welcome to Loki</h1>
</header>

<main>
	<div class="hero">
		<div class="ic"><Shield size={20} aria-hidden="true" /></div>
		<div>
			<h2>House rules</h2>
			<p class="sub">One quick read before you jump in</p>
		</div>
	</div>
	{#if data.changed}
		<div class="changed" role="status">
			<Info size={16} aria-hidden="true" />
			<p>The house rules changed. Please read them again and re-accept to continue.</p>
		</div>
	{/if}
	<!-- Safe: sanitized with DOMPurify on the server (see content.ts). -->
	<article class="prose">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html data.html}
	</article>
</main>

<div class="bar">
	<form
		method="POST"
		action="?/accept"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update({ reset: false });
				submitting = false;
			};
		}}
	>
		<label class="check">
			<input type="checkbox" name="agree" bind:checked={agreed} />
			<span>I've read the house rules and I'll stick to them.</span>
		</label>
		{#if form?.error}
			<p class="error" role="alert">{form.error}</p>
		{/if}
		<button type="submit" class="accept" disabled={!agreed || submitting}>
			{data.changed ? 'Accept the updated rules' : 'Accept & enter Loki'}
		</button>
	</form>
	<form method="POST" action="/logout">
		<button type="submit" class="signout">Sign out instead</button>
	</form>
</div>

<style>
	.top {
		position: sticky;
		top: var(--banners-height, 0px);
		z-index: 5;
		padding: 12px var(--gutter);
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}
	h1 {
		margin: 0;
		font-size: 18px;
	}
	main {
		max-width: 44rem;
		margin: 0 auto;
		/* room for the fixed accept bar */
		padding: var(--gutter) var(--gutter) 14rem;
	}
	.hero {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 6px 0 12px;
	}
	.ic {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		width: 38px;
		height: 38px;
		border-radius: 10px;
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}
	h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 700;
	}
	.sub {
		margin: 0;
		font-size: 12px;
		color: var(--text-muted);
	}
	.changed {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		margin-bottom: 12px;
		padding: 10px 12px;
		border: 1px solid var(--accent);
		border-radius: var(--radius);
		background: var(--accent-soft);
		color: var(--accent-soft-text);
		font-size: 12.5px;
		line-height: 1.4;
	}
	.changed :global(svg) {
		flex: 0 0 auto;
		margin-top: 1px;
	}
	.changed p {
		margin: 0;
	}
	.prose {
		background: var(--surface);
		border: 1px solid var(--border);
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
	.prose :global(h1:first-child),
	.prose :global(h2:first-child),
	.prose :global(h3:first-child) {
		margin-top: 0;
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
	.bar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 10;
		padding: 14px var(--gutter) calc(14px + env(safe-area-inset-bottom));
		border-top: 1px solid var(--border);
		background: var(--bg);
	}
	.bar > form {
		max-width: 44rem;
		margin: 0 auto;
	}
	.check {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		font-size: 12.5px;
		line-height: 1.4;
		cursor: pointer;
	}
	.check input {
		flex: 0 0 auto;
		width: 18px;
		height: 18px;
		margin: 1px 0 0;
		accent-color: var(--accent);
	}
	.error {
		margin: 8px 0 0;
		font-size: 12.5px;
		color: var(--down);
	}
	.accept {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 44px;
		margin-top: 12px;
		border: 0;
		border-radius: var(--radius);
		background: var(--accent);
		color: var(--accent-text);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}
	.accept:disabled {
		background: var(--surface-raised);
		color: var(--text-muted);
		cursor: not-allowed;
	}
	.bar > form + form {
		margin-top: 10px;
		text-align: center;
	}
	.signout {
		padding: 4px 8px;
		border: 0;
		background: none;
		color: var(--text-muted);
		font: inherit;
		font-size: 12px;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
</style>
