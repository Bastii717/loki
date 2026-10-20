<script lang="ts">
	import { resolve } from '$app/paths';
	import { relativeTime } from '../time';
	import type { FeedItem } from '../server/feed';

	let { item }: { item: FeedItem } = $props();

	let revealed = $state(false);
	const memeHref = $derived(
		resolve(`/meme/${item.id}` as '/') /* route arrives with the detail page */
	);
	const hidden = $derived(item.blurred !== null && !revealed);
	// svelte-ignore state_referenced_locally
	let score = $state(item.score);
	// svelte-ignore state_referenced_locally
	let userVote = $state<-1 | 0 | 1>(item.userVote);
	let pending = false;
	const scoreLabel = $derived(score > 0 ? `+${score}` : String(score));

	async function vote(dir: 1 | -1) {
		if (pending) return;
		pending = true;
		const prev = { score, userVote };
		const next = userVote === dir ? 0 : dir;
		score += next - userVote;
		userVote = next;
		try {
			const res = await fetch(`/api/memes/${item.id}/vote`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ value: next })
			});
			if (!res.ok) throw new Error(String(res.status));
			const data = (await res.json()) as { score: number; userVote: -1 | 0 | 1 };
			score = data.score;
			userVote = data.userVote;
		} catch {
			score = prev.score;
			userVote = prev.userVote;
		} finally {
			pending = false;
		}
	}
</script>

<article class="card">
	<div class="media">
		<a href={memeHref} tabindex={hidden ? -1 : undefined} aria-label={item.title || 'Meme'}>
			<img
				src={item.thumbUrl}
				alt={item.title}
				width={item.width ?? undefined}
				height={item.height ?? undefined}
				loading="lazy"
				decoding="async"
				class:fallback={item.width === null || item.height === null}
				class:blurred={hidden}
			/>
		</a>
		{#if item.kind !== 'image'}
			<span class="badge">{item.kind === 'video' ? '▶ Video' : 'GIF'}</span>
		{/if}
		{#if hidden}
			<button type="button" class="reveal" onclick={() => (revealed = true)}>
				{item.blurred === 'nsfw'
					? '🔞 Antippen zum Anzeigen'
					: '⚠️ Spoiler — Antippen zum Anzeigen'}
			</button>
		{/if}
	</div>

	<div class="body">
		<div class="info">
			<a href={memeHref} class="title">{item.title || 'Ohne Titel'}</a>
			{#if item.tags.length > 0}
				<ul class="tags">
					{#each item.tags as tag (tag)}
						<li><a href="{resolve('/')}?tag={encodeURIComponent(tag)}" class="chip">#{tag}</a></li>
					{/each}
				</ul>
			{/if}
			<p class="meta">
				<span>von {item.uploader}</span>
				<span aria-label="{item.commentCount} Kommentare">💬 {item.commentCount}</span>
				<span aria-label="{item.viewCount} Aufrufe">👁 {item.viewCount}</span>
				<time datetime={item.createdAt}>{relativeTime(item.createdAt)}</time>
			</p>
		</div>

		<div class="votes">
			<button
				type="button"
				class="arrow up"
				class:active={userVote === 1}
				aria-label="Upvote"
				aria-pressed={userVote === 1}
				onclick={() => vote(1)}>▲</button
			>
			<b class="score" class:pos={score > 0} class:neg={score < 0}>{scoreLabel}</b>
			<button
				type="button"
				class="arrow down"
				class:active={userVote === -1}
				aria-label="Downvote"
				aria-pressed={userVote === -1}
				onclick={() => vote(-1)}>▼</button
			>
		</div>
	</div>
</article>

<style>
	.card {
		background: var(--surface);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.media {
		position: relative;
		background: var(--surface-raised);
		overflow: hidden;
	}

	.media a {
		display: block;
	}

	img {
		display: block;
		width: 100%;
		height: auto;
	}

	img.fallback {
		aspect-ratio: 4 / 3;
		object-fit: cover;
	}

	img.blurred {
		filter: blur(28px);
		transform: scale(1.1);
	}

	.badge {
		position: absolute;
		top: 8px;
		left: 8px;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		background: rgba(0, 0, 0, 0.65);
		color: #fff;
		font-size: 11px;
		font-weight: 600;
		pointer-events: none;
	}

	.reveal {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		border: 0;
		background: var(--overlay);
		font-weight: 600;
		text-align: center;
		cursor: pointer;
	}

	.body {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 8px 10px 10px 12px;
	}

	.info {
		min-width: 0;
	}

	.title {
		display: block;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin: 4px 0 0;
		padding: 0;
		list-style: none;
	}

	.chip {
		display: inline-block;
		padding: 2px 9px;
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent-soft-text);
		font-size: 12px;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		margin: 6px 0 0;
		color: var(--text-muted);
		font-size: 12px;
	}

	.votes {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex-shrink: 0;
		color: var(--text-muted);
	}

	.arrow {
		width: 44px;
		height: 36px;
		padding: 0;
		border: 0;
		background: none;
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
	}

	.arrow.up.active {
		color: var(--up);
	}

	.arrow.down.active {
		color: var(--down);
	}

	.score {
		font-size: 14px;
		font-variant-numeric: tabular-nums;
	}

	.score.pos {
		color: var(--up);
	}

	.score.neg {
		color: var(--down);
	}
</style>
