<script lang="ts">
	import SeasonEffect from '#lib/components/SeasonEffect.svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resolve } from '$app/paths';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Save from 'lucide-svelte/icons/save';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const options = [
		{ name: 'comments', label: 'Comments on my memes' },
		{ name: 'threadComments', label: 'New comments in threads I joined' },
		{ name: 'replies', label: 'Replies to my comments' },
		{ name: 'mentions', label: 'Mentions of me' },
		{ name: 'reportOutcomes', label: 'Outcomes of my reports' }
	] as const;

	let busy = $state(false);

	const submit: SubmitFunction = () => {
		busy = true;
		return async ({ update }) => {
			// keep the ticked boxes as they are; the saved values are what the member just chose
			await update({ reset: false });
			busy = false;
		};
	};
</script>

<svelte:head>
	<title>Notifications · Loki</title>
</svelte:head>

<header class="top season-host">
	<SeasonEffect season={data.season?.id} />
	<a href={resolve('/profile')} class="back" aria-label="Back to profile"><ArrowLeft size={22} /></a
	>
	<h1>Notifications</h1>
</header>

<main>
	<form method="POST" action="?/save" use:enhance={submit}>
		<section class="card" aria-label="Notification preferences">
			{#each options as option (option.name)}
				<label class="check">
					<input type="checkbox" name={option.name} checked={data.prefs[option.name]} />
					<span>{option.label}</span>
				</label>
			{/each}
			<p class="hint">
				Always on: moderation actions on your content, timeouts, admin changes to your profile, and
				Meme of the Month awards.
			</p>
		</section>

		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if form?.saved && !busy}<p class="ok" role="status">Saved.</p>{/if}

		<button type="submit" class="btn primary" disabled={busy}>
			<Save size={16} aria-hidden="true" /> Save
		</button>
	</form>
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
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: var(--radius-pill);
		color: var(--text);
	}

	h1 {
		margin: 0;
		font-size: 18px;
	}

	main {
		max-width: 560px;
		margin: 0 auto;
		padding: 8px var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px;
		border-radius: var(--radius);
		background: var(--surface);
		min-width: 0;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		font-size: 14px;
		cursor: pointer;
	}

	.check input {
		flex: none;
		width: 20px;
		height: 20px;
		margin: 0;
		accent-color: var(--accent);
	}

	.hint {
		margin: 4px 0 0;
		color: var(--text-muted);
		font-size: 13px;
		overflow-wrap: anywhere;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 14px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-raised);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn.primary {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--accent-text);
	}

	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.error,
	.ok {
		margin: 0;
		font-size: 14px;
	}

	.error {
		color: var(--down);
	}

	.ok {
		color: var(--up);
	}
</style>
