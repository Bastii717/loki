<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { relativeTime } from '../time';
	import type { CommentItem } from '../server/comments';
	import type { FeedItem } from '../server/feed';

	let {
		item,
		comments: initialComments,
		viewer
	}: {
		item: FeedItem;
		comments: CommentItem[];
		viewer: { id: number; canModerate: boolean };
	} = $props();

	// The parent keys this component by meme id, so initial props are the whole state.
	// svelte-ignore state_referenced_locally
	let revealed = $state(item.blurred === null);
	// svelte-ignore state_referenced_locally
	let score = $state(item.score);
	// svelte-ignore state_referenced_locally
	let userVote = $state<-1 | 0 | 1>(item.userVote);
	// svelte-ignore state_referenced_locally
	let comments = $state<CommentItem[]>(initialComments);
	let text = $state('');
	let sending = $state(false);
	let commentError = $state('');
	let voting = false;
	const scoreLabel = $derived(score > 0 ? `+${score}` : String(score));

	// ---- swipe / arrow navigation between feed neighbours
	const feedIds = $derived(page.state.feedIds);
	const index = $derived(feedIds ? feedIds.indexOf(item.id) : -1);
	const prevId = $derived(feedIds && index > 0 ? feedIds[index - 1] : null);
	const nextId = $derived(feedIds && index >= 0 ? (feedIds[index + 1] ?? null) : null);

	function go(id: number | null) {
		if (id === null) return;
		// replaceState keeps "back" pointing at the feed instead of at every swiped meme
		void goto(resolve('/meme/[id]', { id: String(id) }), {
			replaceState: true,
			state: { feedIds }
		});
	}

	const SWIPE_THRESHOLD = 60;
	let startX = 0;
	let startY = 0;
	let tracking = false;

	function onPointerDown(e: PointerEvent) {
		tracking = true;
		startX = e.clientX;
		startY = e.clientY;
	}
	function onPointerUp(e: PointerEvent) {
		if (!tracking) return;
		tracking = false;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
		// swipe left = next meme, swipe right = previous
		go(dx < 0 ? nextId : prevId);
	}

	function back() {
		if (feedIds) history.back();
		else void goto(resolve('/'));
	}

	// ---- seen
	onMount(() => {
		void fetch(`/api/memes/${item.id}/seen`, { method: 'POST' }).catch(() => {});
	});

	// ---- voting
	async function vote(dir: 1 | -1) {
		if (voting) return;
		voting = true;
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
			voting = false;
		}
	}

	// ---- comments
	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const value = text.trim();
		if (!value || sending) return;
		sending = true;
		commentError = '';
		try {
			const res = await fetch(`/api/memes/${item.id}/comments`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: value })
			});
			if (!res.ok) throw new Error(String(res.status));
			comments.unshift((await res.json()) as CommentItem);
			text = '';
		} catch {
			commentError = 'Kommentar konnte nicht gesendet werden.';
		} finally {
			sending = false;
		}
	}

	async function remove(c: CommentItem) {
		commentError = '';
		try {
			const res = await fetch(`/api/comments/${c.id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 404) throw new Error(String(res.status));
			comments = comments.filter((x) => x.id !== c.id);
		} catch {
			commentError = 'Kommentar konnte nicht gelöscht werden.';
		}
	}
</script>

<header class="bar">
	<button type="button" class="icon-btn" onclick={back} aria-label="Zurück">←</button>
	<span class="bar-title">{item.title || 'Ohne Titel'}</span>
	{#if feedIds}
		<div class="pager">
			<button
				type="button"
				class="icon-btn"
				disabled={prevId === null}
				onclick={() => go(prevId)}
				aria-label="Vorheriges Meme">‹</button
			>
			<button
				type="button"
				class="icon-btn"
				disabled={nextId === null}
				onclick={() => go(nextId)}
				aria-label="Nächstes Meme">›</button
			>
		</div>
	{/if}
</header>

<main class="detail">
	<div class="stage" onpointerdown={onPointerDown} onpointerup={onPointerUp} role="presentation">
		{#if item.kind === 'video'}
			<video src={item.mediaUrl} controls loop muted playsinline autoplay class:blurred={!revealed}
			></video>
		{:else}
			<img src={item.mediaUrl} alt={item.title} class:blurred={!revealed} draggable="false" />
		{/if}
		{#if !revealed}
			<button type="button" class="reveal" onclick={() => (revealed = true)}>
				{item.blurred === 'nsfw'
					? '🔞 Antippen zum Anzeigen'
					: '⚠️ Spoiler — Antippen zum Anzeigen'}
			</button>
		{/if}
	</div>

	<section class="info">
		<div class="row">
			<div class="grow">
				<h1>{item.title || 'Ohne Titel'}</h1>
				<p class="meta">
					von {item.uploader} ·
					<time datetime={item.createdAt}>{relativeTime(item.createdAt)}</time>
					· 👁 {item.viewCount}
				</p>
			</div>
			<span
				class="star"
				class:on={item.userFavorite}
				role="img"
				aria-label="{item.favoriteCount} Favoriten{item.userFavorite
					? ', von dir favorisiert'
					: ''}">{item.userFavorite ? '★' : '☆'} {item.favoriteCount}</span
			>
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
		{#if item.tags.length > 0}
			<ul class="tags">
				{#each item.tags as tag (tag)}
					<li><a href="{resolve('/')}?tag={encodeURIComponent(tag)}" class="chip">#{tag}</a></li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="comments" aria-labelledby="comments-h">
		<h2 id="comments-h">Kommentare ({comments.length})</h2>
		<form onsubmit={submit}>
			<textarea
				bind:value={text}
				placeholder="Kommentieren…"
				aria-label="Kommentieren"
				maxlength="2000"
				rows="2"></textarea>
			<button type="submit" disabled={sending || text.trim() === ''}>Senden</button>
		</form>
		{#if commentError}
			<p class="error" role="alert">{commentError}</p>
		{/if}
		{#if comments.length === 0}
			<p class="empty">Noch keine Kommentare — sei der Erste! 🎤</p>
		{:else}
			<ul class="list">
				{#each comments as c (c.id)}
					<li>
						<div class="head">
							<b>{c.author}</b>
							<time datetime={c.createdAt}>{relativeTime(c.createdAt)}</time>
							{#if c.authorId === viewer.id || viewer.canModerate}
								<button
									type="button"
									class="del"
									onclick={() => remove(c)}
									aria-label="Kommentar von {c.author} löschen">Löschen</button
								>
							{/if}
						</div>
						<p>{c.text}</p>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		background: var(--bg);
	}

	.bar-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}

	.pager {
		display: flex;
	}

	.icon-btn {
		width: 44px;
		height: 44px;
		border: 0;
		background: none;
		font-size: 24px;
		line-height: 1;
		cursor: pointer;
	}

	.icon-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.detail {
		max-width: 720px;
		margin: 0 auto;
		padding-bottom: calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}

	.stage {
		position: relative;
		display: flex;
		justify-content: center;
		background: #000;
		overflow: hidden;
		touch-action: pan-y;
		user-select: none;
	}

	.stage img,
	.stage video {
		display: block;
		width: 100%;
		max-height: 75dvh;
		object-fit: contain;
	}

	.blurred {
		filter: blur(28px);
		transform: scale(1.1);
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

	.info {
		padding: 12px var(--gutter);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.grow {
		flex: 1;
		min-width: 0;
	}

	h1 {
		margin: 0;
		font-size: 18px;
		overflow-wrap: anywhere;
	}

	.meta {
		margin: 4px 0 0;
		color: var(--text-muted);
		font-size: 13px;
	}

	.star {
		color: var(--text-muted);
		font-size: 14px;
	}

	.star.on {
		color: var(--accent);
	}

	.votes {
		display: flex;
		flex-direction: column;
		align-items: center;
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

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin: 8px 0 0;
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

	.comments {
		padding: 0 var(--gutter);
	}

	h2 {
		margin: 8px 0;
		font-size: 15px;
	}

	form {
		display: flex;
		gap: 8px;
		align-items: flex-end;
	}

	textarea {
		flex: 1;
		min-width: 0;
		resize: none;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}

	form button {
		padding: 10px 14px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		cursor: pointer;
	}

	form button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.error {
		color: var(--down);
		font-size: 13px;
	}

	.empty {
		padding: 20px 0;
		color: var(--text-muted);
		text-align: center;
	}

	.list {
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		padding: 10px 0;
		border-top: 1px solid var(--border);
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 13px;
	}

	.head time {
		color: var(--text-muted);
	}

	.del {
		margin-left: auto;
		padding: 4px 8px;
		border: 0;
		background: none;
		color: var(--down);
		font-size: 12px;
		cursor: pointer;
	}

	.list p {
		margin: 4px 0 0;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
</style>
