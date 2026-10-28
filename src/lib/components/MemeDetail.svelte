<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import ArrowBigDown from 'lucide-svelte/icons/arrow-big-down';
	import ArrowBigUp from 'lucide-svelte/icons/arrow-big-up';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Ellipsis from 'lucide-svelte/icons/ellipsis';
	import Eye from 'lucide-svelte/icons/eye';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Star from 'lucide-svelte/icons/star';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import { apiErrorMessage } from '../api-error';
	import { lockMessage, refreshStatus, useStatus } from '../status-context';
	import { relativeTime } from '../time';
	import { createVoter } from '../vote';
	import type { CommentItem } from '../server/comments';
	import type { FeedItem } from '../server/feed';
	import Avatar from './Avatar.svelte';
	import AwardBadge from './AwardBadge.svelte';
	import ReportButton from './ReportButton.svelte';
	import RoleBadge from './RoleBadge.svelte';
	import UnderReviewBadge from './UnderReviewBadge.svelte';
	import UnderReviewPanel from './UnderReviewPanel.svelte';

	let {
		item,
		comments: initialComments,
		viewer,
		flags
	}: {
		item: FeedItem;
		comments: CommentItem[];
		viewer: { id: number; canModerate: boolean };
		/** Raw flags when the viewer may delete/flag this meme (uploader or moderator), else null. */
		flags: { nsfw: boolean; spoiler: boolean } | null;
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
	// svelte-ignore state_referenced_locally
	let commentCount = $state(item.commentCount);
	// svelte-ignore state_referenced_locally
	let viewCount = $state(item.viewCount);
	let text = $state('');
	let sending = $state(false);
	let commentError = $state('');
	// vote and favorite errors show next to those controls, not under the comment form
	let reactionError = $state('');
	// svelte-ignore state_referenced_locally
	let favorited = $state(item.userFavorite);
	// svelte-ignore state_referenced_locally
	let favCount = $state(item.favoriteCount);
	let favPending = false;
	let menuOpen = $state(false);
	let menuError = $state('');
	const scoreLabel = $derived(score > 0 ? `+${score}` : String(score));
	// Under review and withheld by the server (members): panel only, no reveal. Mods keep the content.
	const withheld = $derived(item.mediaUrl === null);
	const userHref = (id: number) => resolve('/users/[id]', { id: String(id) });

	// While writes are locked the controls stay in the DOM (focusable, with the reason as title);
	// activating one shows the reason in its usual error line instead of calling the API.
	const status = useStatus();
	const locked = $derived(!status.value.writable);
	const lockTitle = $derived(locked ? lockMessage(status.value) : undefined);
	/** Explains the lock via `show` and returns true while writes are locked. */
	function blocked(show: (message: string) => void): boolean {
		if (!locked) return false;
		refreshStatus();
		show(lockMessage(status.value));
		return true;
	}

	// ---- swipe / arrow navigation between feed neighbours
	const feedIds = $derived(page.state.feedIds);
	const index = $derived(feedIds ? feedIds.indexOf(item.id) : -1);
	const prevId = $derived(feedIds && index > 0 ? feedIds[index - 1] : null);
	const nextId = $derived(feedIds && index >= 0 ? (feedIds[index + 1] ?? null) : null);

	let navigating = false;

	/** Returns whether a navigation started; ignored at the feed edges and while one is in flight. */
	function go(id: number | null): boolean {
		if (id === null || navigating) return false;
		navigating = true;
		// replaceState keeps "back" pointing at the feed instead of at every swiped meme
		void goto(resolve('/meme/[id]', { id: String(id) }), {
			replaceState: true,
			state: { feedIds }
		}).finally(() => (navigating = false));
		return true;
	}

	// Left/right arrows page through the feed; typing and media controls keep their own arrows.
	function onKeydown(e: KeyboardEvent) {
		if (!feedIds || e.defaultPrevented) return;
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
		const target = e.target;
		if (
			target instanceof HTMLElement &&
			(target.isContentEditable ||
				['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO'].includes(target.tagName))
		) {
			return;
		}
		// only swallow the key when it navigates, so horizontal scroll still works at the feed edges
		if (go(e.key === 'ArrowLeft' ? prevId : nextId)) e.preventDefault();
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
		void fetch(`/api/memes/${item.id}/seen`, { method: 'POST' })
			.then(async (res) => {
				if (!res.ok) return;
				// only a first view counts server-side; once per mount as the component is keyed by id
				if (((await res.json()) as { counted: boolean }).counted) viewCount += 1;
			})
			.catch(() => {});
	});

	// ---- voting
	const vote = createVoter(
		() => item.id,
		() => ({ score, userVote }),
		(s) => {
			score = s.score;
			userVote = s.userVote;
		},
		(message) => (reactionError = message)
	);
	function castVote(dir: 1 | -1) {
		if (blocked((m) => (reactionError = m))) return;
		reactionError = '';
		void vote(dir);
	}

	// ---- favorite
	async function toggleFavorite() {
		if (favPending || blocked((m) => (reactionError = m))) return;
		reactionError = '';
		favPending = true;
		const prev = { favorited, favCount };
		favorited = !prev.favorited;
		favCount += favorited ? 1 : -1;
		try {
			const res = await fetch(`/api/memes/${item.id}/favorite`, { method: 'POST' });
			if (!res.ok) {
				favorited = prev.favorited;
				favCount = prev.favCount;
				reactionError = await apiErrorMessage(res, '');
				return;
			}
			const data = (await res.json()) as { favorited: boolean; count: number };
			favorited = data.favorited;
			favCount = data.count;
		} catch {
			favorited = prev.favorited;
			favCount = prev.favCount;
		} finally {
			favPending = false;
		}
	}

	// ---- delete / flags (uploader or moderator)
	async function deleteMeme() {
		if (blocked((m) => (menuError = m))) return;
		if (!confirm('Delete this meme for good?')) return;
		menuError = '';
		try {
			const res = await fetch(`/api/memes/${item.id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 404) {
				menuError = await apiErrorMessage(res, 'Could not delete the meme.');
				return;
			}
			await goto(resolve('/'), { invalidateAll: true });
		} catch {
			menuError = 'Could not delete the meme.';
		}
	}

	async function setFlag(flag: 'nsfw' | 'spoiler', value: boolean) {
		if (blocked((m) => (menuError = m))) return;
		menuError = '';
		try {
			const res = await fetch(`/api/memes/${item.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ [flag]: value })
			});
			if (!res.ok) {
				menuError = await apiErrorMessage(res, 'Could not change the mark.');
				return;
			}
			await invalidateAll();
		} catch {
			menuError = 'Could not change the mark.';
		}
	}

	// ---- comments
	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const value = text.trim();
		if (!value || sending || blocked((m) => (commentError = m))) return;
		sending = true;
		commentError = '';
		try {
			const res = await fetch(`/api/memes/${item.id}/comments`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: value })
			});
			if (!res.ok) {
				commentError = await apiErrorMessage(res, 'Could not send the comment.');
				return;
			}
			comments.unshift((await res.json()) as CommentItem);
			commentCount += 1;
			text = '';
		} catch {
			commentError = 'Could not send the comment.';
		} finally {
			sending = false;
		}
	}

	async function remove(c: CommentItem) {
		if (blocked((m) => (commentError = m))) return;
		commentError = '';
		try {
			const res = await fetch(`/api/comments/${c.id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 404) {
				commentError = await apiErrorMessage(res, 'Could not delete the comment.');
				return;
			}
			if (comments.some((x) => x.id === c.id)) commentCount = Math.max(0, commentCount - 1);
			comments = comments.filter((x) => x.id !== c.id);
		} catch {
			commentError = 'Could not delete the comment.';
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<header class="bar">
	<button type="button" class="icon-btn" onclick={back} aria-label="Back"
		><ArrowLeft size={22} aria-hidden="true" /></button
	>
	<span class="bar-title">{withheld ? 'Under review' : item.title || 'Untitled'}</span>
	{#if feedIds}
		<div class="pager">
			<button
				type="button"
				class="icon-btn"
				disabled={prevId === null}
				onclick={() => go(prevId)}
				aria-label="Previous meme"><ChevronLeft size={24} aria-hidden="true" /></button
			>
			<button
				type="button"
				class="icon-btn"
				disabled={nextId === null}
				onclick={() => go(nextId)}
				aria-label="Next meme"><ChevronRight size={24} aria-hidden="true" /></button
			>
		</div>
	{/if}
	<ReportButton contentType="meme" contentId={item.id} mine={item.mine} />
	{#if flags}
		<div class="menu">
			<button
				type="button"
				class="icon-btn"
				aria-label="More actions"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				onclick={() => (menuOpen = !menuOpen)}><Ellipsis size={22} aria-hidden="true" /></button
			>
			{#if menuOpen}
				<div class="popover" role="menu">
					<button
						type="button"
						role="menuitemcheckbox"
						aria-checked={flags.nsfw}
						aria-disabled={locked ? 'true' : undefined}
						title={lockTitle}
						onclick={() => setFlag('nsfw', !flags.nsfw)}
					>
						<EyeOff size={18} aria-hidden="true" />
						{flags.nsfw ? 'Remove NSFW mark' : 'Mark as NSFW'}
					</button>
					<button
						type="button"
						role="menuitemcheckbox"
						aria-checked={flags.spoiler}
						aria-disabled={locked ? 'true' : undefined}
						title={lockTitle}
						onclick={() => setFlag('spoiler', !flags.spoiler)}
					>
						<TriangleAlert size={18} aria-hidden="true" />
						{flags.spoiler ? 'Remove spoiler mark' : 'Mark as spoiler'}
					</button>
					<button
						type="button"
						role="menuitem"
						class="danger"
						aria-disabled={locked ? 'true' : undefined}
						title={lockTitle}
						onclick={deleteMeme}
					>
						<Trash2 size={18} aria-hidden="true" /> Delete meme
					</button>
					{#if menuError}<p class="error" role="alert">{menuError}</p>{/if}
				</div>
			{/if}
		</div>
	{/if}
</header>

<main class="detail">
	<div class="stage" onpointerdown={onPointerDown} onpointerup={onPointerUp} role="presentation">
		{#if withheld}
			<UnderReviewPanel />
		{:else if item.kind === 'video'}
			<video src={item.mediaUrl} controls loop muted playsinline autoplay class:blurred={!revealed}
			></video>
		{:else}
			<img src={item.mediaUrl} alt={item.title} class:blurred={!revealed} draggable="false" />
		{/if}
		{#if !withheld && !revealed}
			<button type="button" class="reveal" onclick={() => (revealed = true)}>
				{#if item.blurred === 'nsfw'}
					<EyeOff size={20} aria-hidden="true" /> Tap to reveal
				{:else}
					<TriangleAlert size={20} aria-hidden="true" /> Spoiler — tap to reveal
				{/if}
			</button>
		{/if}
	</div>

	<section class="info">
		<div class="row">
			<div class="grow">
				<h1>{withheld ? 'Under review' : item.title || 'Untitled'}</h1>
				{#if item.underReview && !withheld}<p class="review-note"><UnderReviewBadge /></p>{/if}
				<p class="meta">
					{#if item.uploader}
						<span class="by"
							>by <Avatar thumbKey={item.uploaderAvatar} name={item.uploader} size={24} />
							{#if item.uploaderId !== null}<a href={userHref(item.uploaderId)} class="name"
									>{item.uploader}</a
								>{:else}<span class="name">{item.uploader}</span>{/if}<RoleBadge
								role={item.uploaderRole}
							/>
							<span aria-hidden="true">·</span></span
						>
					{/if}
					<time datetime={item.createdAt}>{relativeTime(item.createdAt)}</time>
					·
					<span class="views" aria-label="{viewCount} {viewCount === 1 ? 'view' : 'views'}"
						><Eye size={14} aria-hidden="true" /> {viewCount}</span
					>
					·
					<span
						class="views"
						aria-label="{commentCount} {commentCount === 1 ? 'comment' : 'comments'}"
						><MessageCircle size={14} aria-hidden="true" /> {commentCount}</span
					>
				</p>
				{#if item.awardMonth}<p class="award-note"><AwardBadge month={item.awardMonth} /></p>{/if}
			</div>
			<button
				type="button"
				class="star"
				class:on={favorited}
				aria-pressed={favorited}
				aria-label={favorited ? 'Remove favorite' : 'Save as favorite'}
				aria-disabled={locked ? 'true' : undefined}
				title={lockTitle}
				onclick={toggleFavorite}
				><Star size={22} fill={favorited ? 'currentColor' : 'none'} aria-hidden="true" />
				<span>{favCount}</span></button
			>
			<div class="votes">
				<button
					type="button"
					class="arrow up"
					class:active={userVote === 1}
					aria-label="Upvote"
					aria-pressed={userVote === 1}
					aria-disabled={locked ? 'true' : undefined}
					title={lockTitle}
					onclick={() => castVote(1)}
					><ArrowBigUp
						size={26}
						fill={userVote === 1 ? 'currentColor' : 'none'}
						aria-hidden="true"
					/></button
				>
				<b class="score" class:pos={score > 0} class:neg={score < 0}>{scoreLabel}</b>
				<button
					type="button"
					class="arrow down"
					class:active={userVote === -1}
					aria-label="Downvote"
					aria-pressed={userVote === -1}
					aria-disabled={locked ? 'true' : undefined}
					title={lockTitle}
					onclick={() => castVote(-1)}
					><ArrowBigDown
						size={26}
						fill={userVote === -1 ? 'currentColor' : 'none'}
						aria-hidden="true"
					/></button
				>
			</div>
		</div>
		{#if reactionError}<p class="error" role="alert">{reactionError}</p>{/if}
		{#if item.tags.length > 0}
			<ul class="tags">
				{#each item.tags as tag (tag)}
					<li><a href="{resolve('/')}?tag={encodeURIComponent(tag)}" class="chip">#{tag}</a></li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="comments" aria-labelledby="comments-h">
		<h2 id="comments-h">Comments ({comments.length})</h2>
		<form onsubmit={submit}>
			<textarea
				bind:value={text}
				placeholder="Write a comment…"
				aria-label="Write a comment"
				maxlength="2000"
				rows="2"></textarea>
			<button
				type="submit"
				disabled={sending || text.trim() === ''}
				aria-disabled={locked ? 'true' : undefined}
				title={lockTitle}>Send</button
			>
		</form>
		{#if commentError}
			<p class="error" role="alert">{commentError}</p>
		{/if}
		{#if comments.length === 0}
			<p class="empty">No comments yet — be the first!</p>
		{:else}
			<ul class="list">
				{#each comments as c (c.id)}
					<li>
						<div class="head">
							<span class="author">
								<Avatar thumbKey={c.authorAvatar} name={c.author} size={24} />
								<b><a href={userHref(c.authorId)} class="name">{c.author}</a></b><RoleBadge
									role={c.authorRole}
								/>
							</span>
							<time datetime={c.createdAt}>{relativeTime(c.createdAt)}</time>
							<span class="actions">
								{#if c.authorId === viewer.id || viewer.canModerate}
									<button
										type="button"
										class="del"
										onclick={() => remove(c)}
										aria-disabled={locked ? 'true' : undefined}
										title={lockTitle}
										aria-label="Delete comment by {c.author}">Delete</button
									>
								{/if}
								<ReportButton
									contentType="comment"
									contentId={c.id}
									mine={c.authorId === viewer.id}
								/>
							</span>
						</div>
						{#if c.text === null}
							<p class="review"><EyeOff size={14} aria-hidden="true" /> Under review</p>
						{:else}
							{#if c.underReview}<p class="review-note"><UnderReviewBadge /></p>{/if}
							<p>{c.text}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<style>
	.bar {
		position: sticky;
		/* below the status banner strip, when there is one */
		top: var(--banners-height, 0px);
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
		display: flex;
		align-items: center;
		justify-content: center;
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
		gap: 8px;
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

	.by {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		vertical-align: middle;
		white-space: nowrap;
	}

	.by .name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	a.name:hover {
		text-decoration: underline;
	}

	a.name:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 2px;
	}

	.star {
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 44px;
		padding: 4px 0;
		border: 0;
		background: none;
		color: var(--text-muted);
		font-size: 12px;
		cursor: pointer;
	}

	.views {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		vertical-align: bottom;
	}

	.menu {
		position: relative;
	}

	.popover {
		position: absolute;
		top: 100%;
		right: 0;
		z-index: 6;
		display: flex;
		flex-direction: column;
		min-width: 230px;
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-raised);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.popover button {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding: 0 12px;
		border: 0;
		border-radius: 8px;
		background: none;
		text-align: left;
		cursor: pointer;
	}

	.popover button:hover {
		background: var(--surface);
	}

	.popover .danger {
		color: var(--down);
	}

	.popover .error {
		margin: 4px 12px 8px;
	}

	.star.on {
		color: var(--accent);
	}

	[aria-disabled='true'] {
		opacity: 0.5;
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
		display: flex;
		align-items: center;
		justify-content: center;
		color: inherit;
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
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}

	.author {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}

	.author b {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.head time {
		flex: none;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.actions {
		display: flex;
		align-items: center;
		margin-left: auto;
	}

	.del {
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

	.list p.review {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
		font-style: italic;
	}

	.review-note,
	.award-note {
		margin: 4px 0 0;
	}
</style>
