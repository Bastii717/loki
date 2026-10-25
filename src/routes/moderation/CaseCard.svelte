<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Check from 'lucide-svelte/icons/check';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import Timer from 'lucide-svelte/icons/timer';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import UnderReviewBadge from '#lib/components/UnderReviewBadge.svelte';
	import { modRequest } from '../../lib/moderation-client';
	import {
		CATEGORY_LABELS,
		CONTENT_LABELS,
		formatDateTime,
		pluralize
	} from '../../lib/moderation-labels';
	import { relativeTime } from '../../lib/time';
	import type { OpenCase } from '../../lib/server/moderation-queries';

	let {
		item,
		viewer
	}: { item: OpenCase; viewer: { id: number; role: 'moderator' | 'admin' | 'member' } } = $props();

	let mode = $state<'delete' | 'timeout' | null>(null);
	let busy = $state(false);
	let failure = $state('');
	let days = $state(3);
	let reason = $state('');

	// same matrix as setTimeout_: never yourself, moderators only members
	const canTimeoutAuthor = $derived(
		item.authorId !== viewer.id && (viewer.role === 'admin' || item.authorRole === 'member')
	);
	// reports about your own content are decided by someone else (the server refuses it as well)
	const own = $derived(item.authorId === viewer.id);
	const gone = $derived(item.preview === null);
	const openHref = $derived(
		item.preview?.type === 'meme'
			? `/meme/${item.contentId}`
			: item.preview?.type === 'comment'
				? `/meme/${item.preview.mediaId}`
				: item.preview?.type === 'quote'
					? '/quotes'
					: null
	);

	async function run(body: Record<string, unknown>) {
		if (busy) return;
		busy = true;
		failure = '';
		const result = await modRequest('/api/moderation/case', 'POST', {
			contentType: item.contentType,
			contentId: item.contentId,
			...body
		});
		busy = false;
		if (result.ok) {
			await invalidateAll();
		} else {
			failure = result.message;
			// someone else was faster: show the current state instead of a dead card
			if (/already resolved/.test(result.message)) await invalidateAll();
		}
	}

	function submitTimeout(e: SubmitEvent) {
		e.preventDefault();
		void run({ action: 'timeout', days, reason });
	}
</script>

<article class="card" aria-label="{CONTENT_LABELS[item.contentType]} by {item.author}">
	<header>
		<span class="pill accent">{CONTENT_LABELS[item.contentType]}</span>
		<span class="author">by <strong>{item.author}</strong></span>
		{#if item.underReview}<UnderReviewBadge />{/if}
	</header>

	<div class="preview">
		{#if item.preview?.type === 'meme'}
			<img src={item.preview.thumbUrl} alt={item.preview.title || 'Reported meme'} loading="lazy" />
			<div class="text">
				{#if item.preview.title}<p class="title">{item.preview.title}</p>{/if}
				<p class="muted">
					{item.preview.kind === 'video'
						? 'Video'
						: item.preview.kind === 'gif'
							? 'GIF'
							: 'Image'}{item.preview.nsfw ? ', NSFW' : ''}{item.preview.spoiler ? ', spoiler' : ''}
				</p>
			</div>
		{:else if item.preview?.type === 'comment'}
			<p class="quote">{item.preview.text}</p>
		{:else if item.preview?.type === 'quote'}
			<p class="quote">“{item.preview.text}” <span class="muted">— {item.preview.author}</span></p>
		{:else}
			<p class="muted">
				The content no longer exists. Excerpt at the time of the report: {item.excerpt}
			</p>
		{/if}
	</div>

	<div class="facts">
		<span class="pill">{pluralize(item.reports.length, 'report', 'reports')}</span>
		<span class="pill" title={formatDateTime(item.oldest)}>since {relativeTime(item.oldest)}</span>
		{#each item.categories as c (c.category)}
			<span class="pill">{CATEGORY_LABELS[c.category]} × {c.count}</span>
		{/each}
	</div>

	<details>
		<summary>Reporters ({item.reports.length})</summary>
		<ul class="reporters">
			{#each item.reports as r, i (i)}
				<li>
					<strong>{r.reporter}</strong>
					<span class="muted">{CATEGORY_LABELS[r.category]}, {relativeTime(r.createdAt)}</span>
					{#if r.text}<p class="reporter-text">{r.text}</p>{/if}
				</li>
			{/each}
		</ul>
	</details>

	{#if failure}<p class="error" role="alert">{failure}</p>{/if}

	{#if mode === 'delete'}
		<div class="confirm" role="group" aria-label="Confirm delete">
			<span>Delete this {CONTENT_LABELS[item.contentType].toLowerCase()} for good?</span>
			<button
				type="button"
				class="btn danger"
				disabled={busy}
				onclick={() => run({ action: 'delete' })}
			>
				<Trash2 size={16} aria-hidden="true" /> Yes, delete
			</button>
			<button type="button" class="btn" disabled={busy} onclick={() => (mode = null)}>
				Cancel
			</button>
		</div>
	{:else if mode === 'timeout'}
		<form class="timeout" onsubmit={submitTimeout}>
			<p class="muted">Mute {item.author}. The reports then count as confirmed.</p>
			<p class="muted">The content stays visible. Delete or blur it as well if needed.</p>
			<label>
				Days (1 to 30)
				<input class="field" type="number" min="1" max="30" step="1" required bind:value={days} />
			</label>
			<label>
				Reason
				<textarea class="field" rows="2" maxlength="500" required bind:value={reason}></textarea>
			</label>
			<div class="row">
				<button type="submit" class="btn danger" disabled={busy}>
					<Timer size={16} aria-hidden="true" /> Set timeout
				</button>
				<button type="button" class="btn" disabled={busy} onclick={() => (mode = null)}>
					Cancel
				</button>
			</div>
		</form>
	{:else}
		{#if own}
			<p class="muted">Reports on your own content are decided by another team member.</p>
		{/if}
		<div class="actions">
			{#if !own}
				<button
					type="button"
					class="btn primary"
					disabled={busy}
					onclick={() => run({ action: gone ? 'delete' : 'release' })}
				>
					<Check size={16} aria-hidden="true" />
					{gone ? 'Close' : 'Release'}
				</button>
			{/if}
			{#if item.preview?.type === 'meme' && !item.preview.nsfw && !own}
				<button type="button" class="btn" disabled={busy} onclick={() => run({ action: 'flags' })}>
					<EyeOff size={16} aria-hidden="true" /> NSFW-Blur
				</button>
			{/if}
			{#if !gone}
				<button type="button" class="btn" disabled={busy} onclick={() => (mode = 'delete')}>
					<Trash2 size={16} aria-hidden="true" /> Delete
				</button>
			{/if}
			{#if canTimeoutAuthor}
				<button type="button" class="btn" disabled={busy} onclick={() => (mode = 'timeout')}>
					<Timer size={16} aria-hidden="true" /> Timeout
				</button>
			{/if}
			{#if openHref}
				<a class="btn" href={resolve(openHref as '/')}>
					<ExternalLink size={16} aria-hidden="true" /> Open
				</a>
			{/if}
		</div>
	{/if}
</article>

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.author {
		overflow-wrap: anywhere;
		font-size: 14px;
	}

	.preview {
		display: flex;
		gap: 10px;
		min-width: 0;
	}

	.preview img {
		flex: none;
		width: 112px;
		height: 112px;
		border-radius: 8px;
		background: var(--surface-raised);
		object-fit: cover;
	}

	.text {
		min-width: 0;
	}

	.title,
	.quote {
		margin: 0;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.title {
		font-weight: 600;
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	summary {
		min-height: 32px;
		color: var(--text-muted);
		font-size: 14px;
		cursor: pointer;
	}

	.reporters {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 6px 0 0;
		padding: 0;
		list-style: none;
		font-size: 14px;
	}

	.reporter-text {
		margin: 2px 0 0;
		padding-left: 10px;
		border-left: 2px solid var(--border);
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.actions,
	.confirm,
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.actions .btn {
		flex: 1 1 auto;
	}

	.timeout {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
	}
</style>
