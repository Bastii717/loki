<script lang="ts">
	import { NO_ACCESS_MESSAGE } from '../../lib/auth-messages';

	import SeasonIcon from '#lib/components/SeasonIcon.svelte';
	import { seasonById } from '../../lib/seasons';

	let { data } = $props();

	const season = $derived(data.season);
	const tagline = $derived((season && seasonById(season.id)?.tagline) || "The team's meme board");

	const messages: Record<string, string> = {
		no_access: NO_ACCESS_MESSAGE,
		failed: 'Sign-in failed. Please try again.'
	};
	const message = $derived(data.error ? (messages[data.error] ?? messages.failed) : null);
</script>

<svelte:head>
	<title>Sign in · Loki</title>
</svelte:head>

<main>
	<section class="card">
		<!-- Same mark as the favicon, on the accent colour so it reads on both themes. -->
		<svg class="mark" viewBox="0 0 512 512" width="56" height="56" aria-hidden="true">
			<rect width="512" height="512" rx="112" fill="var(--accent)" />
			<path
				d="M168 112v288h192"
				fill="none"
				stroke="var(--accent-text)"
				stroke-width="72"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
		<h1>
			Loki
			{#if season}
				<SeasonIcon icon={season.icon} label={season.label} size={22} />
			{/if}
		</h1>
		<p class="tagline">{tagline}</p>
		{#if message}
			<p class="error" role="alert">{message}</p>
		{/if}
		<form method="POST">
			<button type="submit">Sign in with Authentik</button>
		</form>
	</section>
</main>

<style>
	main {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: calc(var(--gutter) * 2) calc(var(--gutter) + 6px);
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		width: 100%;
		max-width: 360px;
		padding: 36px 24px 28px;
		border-radius: var(--radius);
		background: var(--surface);
		text-align: center;
	}

	.mark {
		display: block;
		margin-bottom: 6px;
	}

	h1 {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 28px;
		font-weight: 800;
		letter-spacing: 0.3px;
	}

	.tagline {
		margin: 0;
		color: var(--text-muted);
	}

	.error {
		width: 100%;
		margin: 10px 0 0;
		padding: 10px 12px;
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--down) 18%, transparent);
		font-size: 14px;
	}

	form {
		width: 100%;
		margin-top: 14px;
	}

	button {
		width: 100%;
		min-height: 48px;
		padding: 0 18px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		cursor: pointer;
	}

	button:hover {
		filter: brightness(1.08);
	}
</style>
