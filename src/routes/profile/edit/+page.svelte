<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Save from 'lucide-svelte/icons/save';
	import Trash from 'lucide-svelte/icons/trash';
	import Upload from 'lucide-svelte/icons/upload';
	import Avatar from '#lib/components/Avatar.svelte';
	import { formatDate } from '../../../lib/moderation-labels';
	import { DISPLAY_NAME_MAX, MOTTO_MAX } from '../../../lib/profile-limits';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Inputs start from the saved profile (seeded at declaration so the server-rendered page shows
	// it). After a rejected save without script they show what was typed, echoed by the action; a
	// failure that carries no echo (rate limit, write lock, avatar removal) or a locked name field
	// falls back to the saved value, never to an empty field.
	// svelte-ignore state_referenced_locally
	let displayName = $state(
		data.nextRenameAt === null && form?.error && form.displayName !== undefined
			? form.displayName
			: (data.profile.displayName ?? '')
	);
	// svelte-ignore state_referenced_locally
	let motto = $state(form?.error && form.motto !== undefined ? form.motto : data.profile.motto);
	let busy = $state(false);
	let preview = $state<string | null>(null);
	let fileInput: HTMLInputElement | undefined = $state();

	// Typed values stay as they are through failures and through "Remove avatar" (a separate form);
	// only a successful save re-reads the stored values (the server normalises them). Depends on
	// `form` alone: `data` also refreshes in the background and must not wipe edits.
	$effect(() => {
		if (form?.saved) {
			untrack(() => {
				displayName = data.profile.displayName ?? '';
				motto = data.profile.motto;
			});
		}
	});

	const shownName = $derived(data.profile.displayName ?? data.profile.username);

	function setPreview(url: string | null) {
		if (preview) URL.revokeObjectURL(preview);
		preview = url;
	}

	$effect(() => () => {
		if (preview) URL.revokeObjectURL(preview);
	});

	function chosen() {
		const file = fileInput?.files?.[0];
		setPreview(file ? URL.createObjectURL(file) : null);
	}

	const submit: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				if (fileInput) fileInput.value = '';
				setPreview(null);
			}
			busy = false;
		};
	};

	const remove: SubmitFunction = () => {
		busy = true;
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
		};
	};
</script>

<svelte:head>
	<title>Edit profile · Loki</title>
</svelte:head>

<header class="top">
	<a href={resolve('/profile')} class="back" aria-label="Back to profile"><ArrowLeft size={22} /></a
	>
	<h1>Edit profile</h1>
</header>

<main>
	<form method="POST" action="?/save" enctype="multipart/form-data" use:enhance={submit}>
		<section class="card picture" aria-labelledby="picture-title">
			<h2 id="picture-title">Picture</h2>
			<div class="row">
				{#if preview}
					<img class="preview" src={preview} alt="" width="96" height="96" />
				{:else}
					<Avatar
						key={data.profile.avatarKey}
						thumbKey={data.profile.avatarThumbKey}
						name={shownName}
						size={96}
					/>
				{/if}
				<div class="picture-actions">
					<label class="btn">
						<Upload size={16} aria-hidden="true" /> Choose image
						<input
							bind:this={fileInput}
							class="file"
							type="file"
							name="avatar"
							accept="image/jpeg,image/png,image/webp"
							onchange={chosen}
						/>
					</label>
					{#if data.profile.avatarKey}
						<!-- Owned by the separate form below (form attribute), so Enter in a text field submits
							Save, the only submit button of the main form, never this one. -->
						<button type="submit" class="btn" form="remove-avatar" disabled={busy}>
							<Trash size={16} aria-hidden="true" /> Remove avatar
						</button>
					{/if}
				</div>
			</div>
			<p class="hint">JPEG, PNG or WebP. It is cropped to a square.</p>
		</section>

		<section class="card" aria-labelledby="about-title">
			<h2 id="about-title">About you</h2>
			<label>
				Display name
				<input
					class="field"
					type="text"
					name="displayName"
					bind:value={displayName}
					maxlength={DISPLAY_NAME_MAX}
					placeholder={data.profile.username}
					autocomplete="off"
					disabled={data.nextRenameAt !== null}
				/>
			</label>
			{#if data.nextRenameAt}
				<p class="hint">You can change your name again on {formatDate(data.nextRenameAt)}.</p>
			{:else}
				<p class="hint">
					You can change it once every 30 days. Your username stays {data.profile.username}.
				</p>
			{/if}

			<label>
				Motto
				<input
					class="field"
					type="text"
					name="motto"
					bind:value={motto}
					maxlength={MOTTO_MAX}
					autocomplete="off"
				/>
			</label>
			<p class="hint counter">{[...motto].length} / {MOTTO_MAX}</p>
		</section>

		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if form?.saved && !busy}<p class="ok" role="status">Saved.</p>{/if}
		{#if form?.removed && !busy}<p class="ok" role="status">Avatar removed.</p>{/if}

		<button type="submit" class="btn primary" disabled={busy}>
			<Save size={16} aria-hidden="true" /> Save
		</button>
	</form>
	<form id="remove-avatar" method="POST" action="?/removeAvatar" use:enhance={remove}></form>
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

	h2 {
		margin: 0;
		font-size: 16px;
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
		gap: 10px;
		padding: 14px;
		border-radius: var(--radius);
		background: var(--surface);
		min-width: 0;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.preview {
		flex: none;
		width: 96px;
		height: 96px;
		border-radius: 50%;
		object-fit: cover;
	}

	.picture-actions {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
	}

	label.btn {
		flex-direction: row;
		position: relative;
	}

	/* visually hidden but still focusable; the wrapping label is the tap target */
	.file {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	label.btn:focus-within {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: 13px;
		overflow-wrap: anywhere;
	}

	.counter {
		margin-top: -6px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.field {
		width: 100%;
		min-width: 0;
		min-height: 44px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-raised);
		color: var(--text);
		font: inherit;
	}

	.field:disabled {
		opacity: 0.6;
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
