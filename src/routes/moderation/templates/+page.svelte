<script lang="ts">
	import { enhance } from '$app/forms';
	import ImagePlus from 'lucide-svelte/icons/image-plus';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** The longest side of a thumbnail in the list, and in the removed group. */
	const BOX = 96;
	const SMALL_BOX = 48;
	const NAME_MAX = 60;

	/** The row's size scaled into the box, so the layout does not jump while the image loads. */
	function boxed(width: number, height: number, box = BOX) {
		const scale = box / Math.max(width, height, 1);
		return {
			w: Math.max(1, Math.round(width * scale)),
			h: Math.max(1, Math.round(height * scale))
		};
	}

	function usage(count: number): string {
		if (count === 0) return 'Not used yet';
		return count === 1 ? 'Used once' : `Used ${count} times`;
	}

	/** Keeps what is typed in the other fields while the list reloads. */
	const keepValues =
		() =>
		async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) =>
			update({ reset: false });
</script>

<svelte:head>
	<title>Templates · Loki</title>
</svelte:head>

<h1>Templates</h1>

<section class="card" aria-labelledby="add-title">
	<h2 id="add-title">Add template</h2>
	<p class="muted">JPEG, PNG or WebP. Members can pick it in the meme generator.</p>
	<form method="POST" action="?/add" enctype="multipart/form-data" use:enhance>
		<label>
			Name
			<input
				class="field"
				type="text"
				name="name"
				maxlength={NAME_MAX}
				required
				autocomplete="off"
			/>
		</label>
		<label>
			Image
			<input
				class="field"
				type="file"
				name="file"
				accept="image/jpeg,image/png,image/webp"
				required
			/>
		</label>
		<button type="submit" class="btn primary">
			<ImagePlus size={16} aria-hidden="true" /> Add template
		</button>
	</form>
	{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
</section>

{#if data.templates.length === 0}
	<p class="empty">No templates yet. Add the first one above.</p>
{:else}
	<ul class="list">
		{#each data.templates as t (t.id)}
			{@const size = boxed(t.width, t.height)}
			<li class="card">
				<div class="head">
					<img
						src="/api/templates/{t.id}/thumb"
						alt=""
						width={size.w}
						height={size.h}
						loading="lazy"
					/>
					<div class="meta">
						<strong>{t.name}</strong>
						<span class="muted">{usage(t.usageCount)}</span>
					</div>
				</div>
				<div class="actions">
					<form class="rename" method="POST" action="?/rename" use:enhance={keepValues}>
						<input type="hidden" name="id" value={t.id} />
						<label>
							<span class="muted">Rename</span>
							<input
								class="field"
								type="text"
								name="name"
								value={t.name}
								maxlength={NAME_MAX}
								required
								autocomplete="off"
							/>
						</label>
						<button type="submit" class="btn">Save</button>
					</form>
					<form method="POST" action="?/remove" use:enhance>
						<input type="hidden" name="id" value={t.id} />
						<button type="submit" class="btn">
							<Trash2 size={16} aria-hidden="true" /> Remove
						</button>
					</form>
				</div>
			</li>
		{/each}
	</ul>
{/if}

{#if data.removed.length > 0}
	<details class="card">
		<summary>Removed ({data.removed.length})</summary>
		<ul class="list">
			{#each data.removed as t (t.id)}
				{@const size = boxed(t.width, t.height, SMALL_BOX)}
				<li class="head removed">
					<img
						src="/api/templates/{t.id}/thumb"
						alt=""
						width={size.w}
						height={size.h}
						loading="lazy"
					/>
					<div class="meta">
						<strong>{t.name}</strong>
						<span class="muted">{usage(t.usageCount)}</span>
					</div>
					<form method="POST" action="?/restore" use:enhance>
						<input type="hidden" name="id" value={t.id} />
						<button type="submit" class="btn">
							<RotateCcw size={16} aria-hidden="true" /> Restore
						</button>
					</form>
				</li>
			{/each}
		</ul>
	</details>
{/if}

<style>
	h1 {
		margin: 0;
		font-size: 20px;
	}

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

	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}

	.head img {
		flex: none;
		border-radius: 6px;
		background: var(--surface-raised);
	}

	.meta {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.meta strong {
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.actions form {
		flex-direction: row;
		align-items: flex-end;
	}

	.rename {
		flex: 1 1 220px;
	}

	.rename label {
		flex: 1;
		min-width: 0;
	}

	summary {
		min-height: 44px;
		display: flex;
		align-items: center;
		font-weight: 600;
		cursor: pointer;
	}

	.removed form {
		flex: none;
	}
</style>
