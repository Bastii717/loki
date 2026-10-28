<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowBigDown from 'lucide-svelte/icons/arrow-big-down';
	import ArrowBigUp from 'lucide-svelte/icons/arrow-big-up';
	import Eye from 'lucide-svelte/icons/eye';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import ImageOff from 'lucide-svelte/icons/image-off';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Play from 'lucide-svelte/icons/play';
	import Star from 'lucide-svelte/icons/star';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import { apiErrorMessage } from '../api-error';
	import { lockMessage, refreshStatus, useStatus } from '../status-context';
	import { relativeTime } from '../time';
	import { createVoter } from '../vote';
	import type { FeedItem } from '../server/feed';
	import Avatar from './Avatar.svelte';
	import AwardBadge from './AwardBadge.svelte';
	import ReportButton from './ReportButton.svelte';
	import RoleBadge from './RoleBadge.svelte';
	import UnderReviewBadge from './UnderReviewBadge.svelte';
	import UnderReviewPanel from './UnderReviewPanel.svelte';

	let { item, feedIds }: { item: FeedItem; feedIds?: string[] } = $props();

	let revealed = $state(false);
	// The thumbnail could not be loaded (object gone, media route failed): show a placeholder
	// instead of an empty box.
	let broken = $state(false);
	function watchBroken(img: HTMLImageElement) {
		// An error fired before hydration is not replayed, so also check the current state.
		if (img.complete && img.naturalWidth === 0) broken = true;
	}
	const memeHref = $derived(resolve('/meme/[pid]', { pid: item.id }));
	const userHref = $derived(
		item.uploaderId === null ? null : resolve('/users/[pid]', { pid: item.uploaderId })
	);

	// Client-side nav that hands the feed's id order to the detail view for swipe navigation.
	function open(e: MouseEvent) {
		if (!feedIds || e.defaultPrevented || e.button !== 0) return;
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		e.preventDefault();
		void goto(memeHref, { state: { feedIds } });
	}
	// Under review and withheld by the server (members): panel only, no reveal. Mods keep the content.
	const withheld = $derived(item.mediaUrl === null);
	const hidden = $derived(!withheld && item.blurred !== null && !revealed);
	// svelte-ignore state_referenced_locally
	let score = $state(item.score);
	// svelte-ignore state_referenced_locally
	let userVote = $state<-1 | 0 | 1>(item.userVote);
	// svelte-ignore state_referenced_locally
	let favorited = $state(item.userFavorite);
	let favPending = false;
	const scoreLabel = $derived(score > 0 ? `+${score}` : String(score));

	// While writes are locked the controls stay in the DOM (focusable, with the reason as title);
	// activating one shows the reason instead of calling the API.
	const status = useStatus();
	const locked = $derived(!status.value.writable);
	let note = $state('');
	function blocked(): boolean {
		if (!locked) return false;
		refreshStatus();
		note = lockMessage(status.value);
		return true;
	}

	async function toggleFavorite() {
		if (favPending || blocked()) return;
		note = '';
		favPending = true;
		const prev = favorited;
		favorited = !prev;
		try {
			const res = await fetch(`/api/memes/${item.id}/favorite`, { method: 'POST' });
			if (!res.ok) {
				favorited = prev;
				note = await apiErrorMessage(res, '');
				return;
			}
			favorited = ((await res.json()) as { favorited: boolean }).favorited;
		} catch {
			favorited = prev;
		} finally {
			favPending = false;
		}
	}

	const vote = createVoter(
		() => item.id,
		() => ({ score, userVote }),
		(s) => {
			score = s.score;
			userVote = s.userVote;
		},
		(message) => (note = message)
	);
	function castVote(dir: 1 | -1) {
		if (blocked()) return;
		note = '';
		void vote(dir);
	}
</script>

<article class="card">
	<div class="media">
		<a
			href={memeHref}
			onclick={open}
			tabindex={hidden ? -1 : undefined}
			aria-label={withheld ? 'Under review' : item.title || 'Meme'}
		>
			{#if withheld}
				<UnderReviewPanel />
			{:else if broken}
				<div
					class="missing"
					style:aspect-ratio={item.width && item.height
						? `${item.width} / ${item.height}`
						: '4 / 3'}
				>
					<ImageOff size={28} aria-hidden="true" />
					<span>Image unavailable</span>
				</div>
			{:else}
				<img
					src={item.thumbUrl}
					alt={item.title}
					width={item.width ?? undefined}
					height={item.height ?? undefined}
					loading="lazy"
					decoding="async"
					class:fallback={item.width === null || item.height === null}
					class:blurred={hidden}
					onerror={() => (broken = true)}
					use:watchBroken
				/>
			{/if}
		</a>
		<!-- Rendered before the badges, star and flag so those stay clickable on top of the overlay. -->
		{#if hidden}
			<button type="button" class="reveal" onclick={() => (revealed = true)}>
				{#if item.blurred === 'nsfw'}
					<EyeOff size={20} aria-hidden="true" /> Tap to reveal
				{:else}
					<TriangleAlert size={20} aria-hidden="true" /> Spoiler — tap to reveal
				{/if}
			</button>
		{/if}
		{#if item.underReview && !withheld}<UnderReviewBadge overlay />{/if}
		{#if item.kind !== 'image'}
			<span class="badge">
				{#if item.kind === 'video'}<Play size={11} fill="currentColor" aria-hidden="true" /> Video{:else}GIF{/if}
			</span>
		{/if}
		<button
			type="button"
			class="fav"
			class:on={favorited}
			aria-label={favorited ? 'Remove favorite' : 'Save as favorite'}
			aria-pressed={favorited}
			aria-disabled={locked ? 'true' : undefined}
			title={locked ? lockMessage(status.value) : undefined}
			onclick={toggleFavorite}
			><Star size={20} fill={favorited ? 'currentColor' : 'none'} aria-hidden="true" /></button
		>
		<ReportButton contentType="meme" contentId={item.id} mine={item.mine} variant="overlay" />
	</div>

	<div class="body">
		<div class="info">
			{#if !withheld}
				<a href={memeHref} onclick={open} class="title">{item.title || 'Untitled'}</a>
			{/if}
			{#if item.tags.length > 0}
				<ul class="tags">
					{#each item.tags as tag (tag)}
						<li><a href="{resolve('/')}?tag={encodeURIComponent(tag)}" class="chip">#{tag}</a></li>
					{/each}
				</ul>
			{/if}
			{#if item.awardMonth}<p class="award"><AwardBadge month={item.awardMonth} /></p>{/if}
			<p class="meta">
				{#if item.uploader}
					<span class="by"
						>by <Avatar thumbKey={item.uploaderAvatar} name={item.uploader} size={20} />
						{#if userHref}<a href={userHref} class="name">{item.uploader}</a>{:else}<span
								class="name">{item.uploader}</span
							>{/if}<RoleBadge role={item.uploaderRole} /></span
					>
				{/if}
				<span
					class="stat"
					aria-label="{item.commentCount} {item.commentCount === 1 ? 'comment' : 'comments'}"
					><MessageCircle size={14} aria-hidden="true" /> {item.commentCount}</span
				>
				<span class="stat" aria-label="{item.viewCount} {item.viewCount === 1 ? 'view' : 'views'}"
					><Eye size={14} aria-hidden="true" /> {item.viewCount}</span
				>
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
				aria-disabled={locked ? 'true' : undefined}
				title={locked ? lockMessage(status.value) : undefined}
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
				title={locked ? lockMessage(status.value) : undefined}
				onclick={() => castVote(-1)}
				><ArrowBigDown
					size={26}
					fill={userVote === -1 ? 'currentColor' : 'none'}
					aria-hidden="true"
				/></button
			>
		</div>
	</div>
	{#if note}<p class="error" role="alert">{note}</p>{/if}
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

	.missing {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		max-height: 60vh;
		color: var(--text-muted);
		font-size: 13px;
	}

	.fav {
		position: absolute;
		top: 6px;
		right: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: rgba(0, 0, 0, 0.55);
		color: #fff;
		cursor: pointer;
	}

	.fav.on {
		color: #ffd24a;
	}

	.stat {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 3px;
		white-space: nowrap;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
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
		gap: 8px;
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

	.award {
		margin: 6px 0 0;
	}

	.meta {
		display: flex;
		flex-wrap: nowrap;
		align-items: center;
		gap: 4px 10px;
		margin: 6px 0 0;
		color: var(--text-muted);
		font-size: 12px;
	}

	.meta time {
		flex: none;
		white-space: nowrap;
	}

	.by {
		display: inline-flex;
		flex: 0 1 auto;
		align-items: center;
		gap: 4px;
		min-width: 0;
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

	[aria-disabled='true'] {
		opacity: 0.5;
	}

	.error {
		margin: 0;
		padding: 0 12px 10px;
		color: var(--down);
		font-size: 13px;
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
