<script lang="ts">
	import { resolve } from '$app/paths';
	import ArrowBigDown from 'lucide-svelte/icons/arrow-big-down';
	import ArrowBigUp from 'lucide-svelte/icons/arrow-big-up';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Star from 'lucide-svelte/icons/star';
	import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
	import type { FeedItem } from '../server/feed';

	let { item, active = false }: { item: FeedItem; active?: boolean } = $props();
	let video = $state<HTMLVideoElement>();

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
	let voting = false;
	const scoreLabel = $derived(score > 0 ? `+${score}` : String(score));

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
</script>

<div class="media">
	{#if item.kind === 'video'}
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
	{#if !revealed}
		<button type="button" class="reveal" onclick={() => (revealed = true)}>
			{#if item.blurred === 'nsfw'}
				<EyeOff size={20} aria-hidden="true" /> Antippen zum Anzeigen
			{:else}
				<TriangleAlert size={20} aria-hidden="true" /> Spoiler — Antippen zum Anzeigen
			{/if}
		</button>
	{/if}
</div>

<div class="caption">
	<b>{item.title || 'Ohne Titel'}</b>
	<span>von {item.uploader}</span>
</div>

<div class="rail">
	<button
		type="button"
		class="arrow up"
		class:active={userVote === 1}
		aria-label="Hochwählen"
		aria-pressed={userVote === 1}
		onclick={() => vote(1)}
		><ArrowBigUp size={26} fill={userVote === 1 ? 'currentColor' : 'none'} /></button
	>
	<b class="score" class:pos={score > 0} class:neg={score < 0}>{scoreLabel}</b>
	<button
		type="button"
		class="arrow down"
		class:active={userVote === -1}
		aria-label="Runterwählen"
		aria-pressed={userVote === -1}
		onclick={() => vote(-1)}
		><ArrowBigDown size={26} fill={userVote === -1 ? 'currentColor' : 'none'} /></button
	>
	<span
		class="stat"
		class:on={item.userFavorite}
		role="img"
		aria-label="{item.favoriteCount} Favoriten{item.userFavorite ? ', von dir favorisiert' : ''}"
		><Star size={22} fill={item.userFavorite ? 'currentColor' : 'none'} /><small
			>{item.favoriteCount}</small
		></span
	>
	<a
		class="stat"
		href={resolve('/meme/[id]', { id: String(item.id) })}
		aria-label="{item.commentCount} Kommentare"
		><MessageCircle size={22} /><small>{item.commentCount}</small></a
	>
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

	.caption span {
		font-size: 13px;
		opacity: 0.85;
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
