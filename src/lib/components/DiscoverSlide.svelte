<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowBigDown from 'lucide-svelte/icons/arrow-big-down';
	import ArrowBigUp from 'lucide-svelte/icons/arrow-big-up';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Star from 'lucide-svelte/icons/star';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import { lockMessage, useStatus } from '../status-context';
	import { createVoter } from '../vote';
	import type { FeedItem } from '../server/feed';
	import Avatar from './Avatar.svelte';
	import ReportButton from './ReportButton.svelte';
	import RoleBadge from './RoleBadge.svelte';
	import UnderReviewBadge from './UnderReviewBadge.svelte';
	import UnderReviewPanel from './UnderReviewPanel.svelte';

	let { item, active = false }: { item: FeedItem; active?: boolean } = $props();
	let video = $state<HTMLVideoElement>();
	// Under review and withheld by the server (members): panel only, no reveal. Mods keep the content.
	const withheld = $derived(item.mediaUrl === null);

	// Only the active slide plays; the rest stay paused so swiping does not decode a pile of videos.
	$effect(() => {
		if (!video) return;
		if (active) void video.play().catch(() => {});
		else video.pause();
	});

	// The parent keys this component by meme id, so initial props are the whole state.
	// svelte-ignore state_referenced_locally
	let revealed = $state(item.blurred === null);
	// svelte-ignore state_referenced_locally
	let score = $state(item.score);
	// svelte-ignore state_referenced_locally
	let userVote = $state<-1 | 0 | 1>(item.userVote);
	const scoreLabel = $derived(score > 0 ? `+${score}` : String(score));

	// While writes are locked the vote arrows stay in the DOM (focusable, with the reason as title);
	// activating one shows the reason instead of calling the API.
	const status = useStatus();
	const locked = $derived(!status.value.writable);
	let note = $state('');

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
		note = locked ? lockMessage(status.value) : '';
		if (!locked) void vote(dir);
	}
</script>

<div class="media">
	{#if withheld}
		<UnderReviewPanel />
	{:else if item.kind === 'video'}
		<video
			bind:this={video}
			src={item.mediaUrl}
			loop
			muted
			playsinline
			preload="metadata"
			class:blurred={!revealed}
		></video>
	{:else}
		<img
			src={item.mediaUrl}
			alt={item.title}
			loading="lazy"
			class:blurred={!revealed}
			draggable="false"
		/>
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

<div class="caption">
	{#if note}<p class="note" role="alert">{note}</p>{/if}
	<b>{withheld ? 'Under review' : item.title || 'Untitled'}</b>
	{#if item.uploader}
		<span class="by"
			>by <Avatar thumbKey={item.uploaderAvatar} name={item.uploader} size={20} />
			<span class="name">{item.uploader}</span><RoleBadge role={item.uploaderRole} /></span
		>
	{/if}
	{#if item.underReview && !withheld}<UnderReviewBadge />{/if}
</div>

<div class="rail">
	<button
		type="button"
		class="arrow up"
		class:active={userVote === 1}
		aria-label="Upvote"
		aria-pressed={userVote === 1}
		aria-disabled={locked ? 'true' : undefined}
		title={locked ? lockMessage(status.value) : undefined}
		onclick={() => castVote(1)}
		><ArrowBigUp size={26} fill={userVote === 1 ? 'currentColor' : 'none'} /></button
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
		><ArrowBigDown size={26} fill={userVote === -1 ? 'currentColor' : 'none'} /></button
	>
	<span
		class="stat"
		class:on={item.userFavorite}
		role="img"
		aria-label="{item.favoriteCount} {item.favoriteCount === 1
			? 'favorite'
			: 'favorites'}{item.userFavorite ? ', favorited by you' : ''}"
		><Star size={22} fill={item.userFavorite ? 'currentColor' : 'none'} /><small
			>{item.favoriteCount}</small
		></span
	>
	<a
		class="stat"
		href={resolve('/meme/[id]', { id: String(item.id) })}
		aria-label="{item.commentCount} {item.commentCount === 1 ? 'comment' : 'comments'}"
		><MessageCircle size={22} /><small>{item.commentCount}</small></a
	>
	<ReportButton contentType="meme" contentId={item.id} mine={item.mine} />
</div>

<style>
	.media {
		position: absolute;
		inset: 0 0 calc(var(--tabbar-height) + env(safe-area-inset-bottom));
		display: flex;
		align-items: center;
		justify-content: center;
		background: #000;
		overflow: hidden;
	}

	.media img,
	.media video {
		width: 100%;
		height: 100%;
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
		color: var(--text);
		font-weight: 600;
		text-align: center;
		cursor: pointer;
	}

	.caption {
		position: absolute;
		left: var(--gutter);
		right: 72px;
		bottom: calc(var(--tabbar-height) + 12px + env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		color: #fff;
		text-shadow: 0 1px 4px rgb(0 0 0 / 0.8);
		pointer-events: none;
		overflow-wrap: anywhere;
	}

	.note {
		margin: 0 0 6px;
		padding: 6px 10px;
		border-radius: var(--radius);
		background: rgb(0 0 0 / 0.65);
		font-size: 13px;
		text-shadow: none;
	}

	.caption span {
		font-size: 13px;
		opacity: 0.85;
	}

	/* The text is dimmed by colour, not opacity, so the badge keeps full strength. The overlay is
	   dark in every theme: the badge goes white with a halo (text-shadow does not reach SVG). */
	.caption .by {
		--role-badge-color: #fff;
		--role-badge-shadow: drop-shadow(0 1px 2px rgb(0 0 0 / 0.8));
		display: flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		opacity: 1;
		color: rgb(255 255 255 / 0.85);
		white-space: nowrap;
	}

	.caption .by .name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		opacity: 1;
	}

	.rail {
		position: absolute;
		right: 6px;
		bottom: calc(var(--tabbar-height) + 12px + env(safe-area-inset-bottom));
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 6px 2px;
		border-radius: var(--radius-pill);
		background: rgb(0 0 0 / 0.45);
		color: #fff;
	}

	.arrow {
		width: 44px;
		height: 40px;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font-size: 18px;
		cursor: pointer;
	}

	.arrow[aria-disabled='true'] {
		opacity: 0.5;
	}

	.arrow.up.active {
		color: var(--up);
	}

	.arrow.down.active {
		color: var(--down);
	}

	.score.pos {
		color: var(--up);
	}

	.score.neg {
		color: var(--down);
	}

	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 44px;
		padding: 6px 0;
		font-size: 20px;
		line-height: 1.1;
	}

	.stat small {
		font-size: 12px;
	}

	.stat.on {
		color: #ffd24a;
	}
</style>
