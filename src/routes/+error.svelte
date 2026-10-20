<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const heading = $derived(
		page.status === 404 ? 'Seite nicht gefunden' : 'Da ist was schiefgelaufen'
	);
</script>

<svelte:head>
	<title>Fehler {page.status} · Loki</title>
</svelte:head>

<main>
	<p class="status">{page.status}</p>
	<h1>{heading}</h1>
	<p class="message">{page.error?.message}</p>
	<a class="home" href={resolve('/')}>Zur Startseite</a>
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
