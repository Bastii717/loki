<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const heading = $derived(page.status === 404 ? 'Page not found' : 'Something went wrong');

	// SvelteKit fills in terse defaults when nothing threw a message of its own; those get a friendlier
	// line here. Everything the app throws itself (`error(404, 'Meme not found')`) is shown as is.
	const GENERIC: Record<string, string> = {
		'Not Found': 'That address does not exist, or not anymore.',
		'Internal Error': 'Please try again later.',
		'Unknown Error': 'Please try again later.'
	};
	const message = $derived.by(() => {
		const raw = page.error?.message ?? '';
		return GENERIC[raw] ?? raw;
	});
</script>

<svelte:head>
	<title>Error {page.status} · Loki</title>
</svelte:head>

<main>
	<p class="status">{page.status}</p>
	<h1>{heading}</h1>
	{#if message}
		<p class="message">{message}</p>
	{/if}
	<a class="home" href={resolve('/')}>Back to the feed</a>
</main>

<style>
	main {
		max-width: 560px;
		margin: 0 auto;
		padding: 20vh var(--gutter) calc(var(--tabbar-height) + 32px);
		text-align: center;
	}

	.status {
		margin: 0;
		color: var(--accent-soft-text);
		font-size: 56px;
		font-weight: 800;
	}

	h1 {
		margin: 4px 0 8px;
		font-size: 22px;
	}

	.message {
		margin: 0 0 24px;
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}

	.home {
		display: inline-block;
		padding: 10px 18px;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}
</style>
