<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ArrowBigDown from 'lucide-svelte/icons/arrow-big-down';
	import ArrowBigUp from 'lucide-svelte/icons/arrow-big-up';
	import Eye from 'lucide-svelte/icons/eye';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Play from 'lucide-svelte/icons/play';
	import Star from 'lucide-svelte/icons/star';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import { relativeTime } from '../time';
	import { createVoter } from '../vote';
	import type { FeedItem } from '../server/feed';
	import ReportButton from './ReportButton.svelte';
	import UnderReviewBadge from './UnderReviewBadge.svelte';
	import UnderReviewPanel from './UnderReviewPanel.svelte';

	let { item, feedIds }: { item: FeedItem; feedIds?: number[] } = $props();

	let revealed = $state(false);
	const memeHref = $derived(resolve('/meme/[id]', { id: String(item.id) }));

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

	async function toggleFavorite() {
		if (favPending) return;
		favPending = true;
		const prev = favorited;
		favorited = !prev;
		try {
			const res = await fetch(`/api/memes/${item.id}/favorite`, { method: 'POST' });
			if (!res.ok) throw new Error(String(res.status));
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
		}
	);
</script>

<article class="card">
	<div class="media">
		<a
			href={memeHref}
			onclick={open}
			tabindex={hidden ? -1 : undefined}
			aria-label={withheld ? 'Wird geprüft' : item.title || 'Meme'}
		>
			{#if withheld}
				<UnderReviewPanel />
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
				/>
			{/if}
		</a>
		<!-- Rendered before the badges, star and flag so those stay clickable on top of the overlay. -->
		{#if hidden}
			<button type="button" class="reveal" onclick={() => (revealed = true)}>
				{#if item.blurred === 'nsfw'}
					<EyeOff size={20} aria-hidden="true" /> Antippen zum Anzeigen
				{:else}
					<TriangleAlert size={20} aria-hidden="true" /> Spoiler — Antippen zum Anzeigen
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
			aria-label={favorited ? 'Favorit entfernen' : 'Als Favorit speichern'}
			aria-pressed={favorited}
			onclick={toggleFavorite}
			><Star size={20} fill={favorited ? 'currentColor' : 'none'} aria-hidden="true" /></button
		>
		<ReportButton contentType="meme" contentId={item.id} mine={item.mine} variant="overlay" />
	</div>

	<div class="body">
		<div class="info">
			{#if !withheld}
				<a href={memeHref} onclick={open} class="title">{item.title || 'Ohne Titel'}</a>
			{/if}
			{#if item.tags.length > 0}
				<ul class="tags">
					{#each item.tags as tag (tag)}
						<li><a href="{resolve('/')}?tag={encodeURIComponent(tag)}" class="chip">#{tag}</a></li>
					{/each}
				</ul>
			{/if}
			<p class="meta">
				{#if item.uploader}<span>von {item.uploader}</span>{/if}
				<span class="stat" aria-label="{item.commentCount} Kommentare"
					><MessageCircle size={14} aria-hidden="true" /> {item.commentCount}</span
				>
				<span class="stat" aria-label="{item.viewCount} Aufrufe"
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
				aria-label="Hochwählen"
				aria-pressed={userVote === 1}
				onclick={() => vote(1)}
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
				aria-label="Runterwählen"
				aria-pressed={userVote === -1}
				onclick={() => vote(-1)}
				><ArrowBigDown
					size={26}
					fill={userVote === -1 ? 'currentColor' : 'none'}
					aria-hidden="true"
				/></button
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
		align-items: center;
		gap: 3px;
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
</style>
