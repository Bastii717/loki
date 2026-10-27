<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import Save from 'lucide-svelte/icons/save';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Inputs start from the saved settings (seeded at declaration so the server-rendered page shows
	// them); after a rejected save they keep what was typed. The effect below only follows later
	// updates.
	// svelte-ignore state_referenced_locally
	let mode = $state(form?.error ? form.mode : data.mode);
	// svelte-ignore state_referenced_locally
	let theme = $state(form?.error ? form.theme : data.theme);
	// svelte-ignore state_referenced_locally
	let until = $state(form?.error ? form.until : data.until);
	let busy = $state(false);

	$effect(() => {
		mode = form?.error ? form.mode : data.mode;
		theme = form?.error ? form.theme : data.theme;
		until = form?.error ? form.until : data.until;
	});

	const submit = () => {
		busy = true;
		return async ({ update }: { update: (options?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	};
</script>

<svelte:head>
	<title>Theme · Moderation · Loki</title>
</svelte:head>

<section class="card" aria-labelledby="theme-title">
	<h2 id="theme-title">Seasonal theme</h2>
	<p class="muted">
		By default the theme follows the calendar. You can switch it off or force one theme, for example
		for a party. Times are Berlin time.
	</p>
	<p>
		<span class="pill accent" role="status">{data.status}</span>
	</p>

	<form method="POST" action="?/save" use:enhance={submit}>
		<fieldset>
			<legend class="sr-only">Mode</legend>
			<label class="radio">
				<input type="radio" name="mode" value="auto" bind:group={mode} />
				<span>Automatic</span>
			</label>
			<label class="radio">
				<input type="radio" name="mode" value="off" bind:group={mode} />
				<span>Off</span>
			</label>
			<label class="radio">
				<input type="radio" name="mode" value="forced" bind:group={mode} />
				<span>Force a theme</span>
			</label>
		</fieldset>

		<label>
			Theme
			<select class="field" name="theme" bind:value={theme} disabled={mode !== 'forced'}>
				<option value="">Choose a theme</option>
				{#each data.seasons as season (season.id)}
					<option value={season.id}>{season.label}</option>
				{/each}
			</select>
		</label>

		<label>
			Ends (optional)
			<input
				class="field"
				type="datetime-local"
				name="until"
				bind:value={until}
				disabled={mode !== 'forced'}
			/>
		</label>

		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if form?.saved && !busy}<p class="ok" role="status">Saved.</p>{/if}

		<div class="actions">
			<button type="submit" class="btn primary" disabled={busy}>
				<Save size={16} aria-hidden="true" /> Save
			</button>
			<button type="submit" class="btn" formaction="?/reset" disabled={busy}>
				<RotateCcw size={16} aria-hidden="true" /> Back to automatic
			</button>
		</div>
	</form>
</section>

<section class="card" aria-labelledby="preview-title">
	<h2 id="preview-title">Preview</h2>
	<p class="muted">Opens the feed in that theme for you only. Nobody else sees it.</p>
	<ul class="previews">
		{#each data.seasons as season (season.id)}
			<li>
				<a class="btn" href="{resolve('/')}?season={season.id}">Preview {season.label}</a>
			</li>
		{/each}
	</ul>
</section>

<style>
	h2 {
		margin: 0;
		font-size: 16px;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
	}

	fieldset {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}

	.radio {
		flex-direction: row;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		font-weight: 600;
	}

	.radio input {
		width: 22px;
		height: 22px;
		margin: 0;
		accent-color: var(--accent);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.actions .btn {
		flex: 1 1 140px;
	}

	.previews {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.previews .btn {
		width: 100%;
		text-align: center;
		text-decoration: none;
	}
</style>
