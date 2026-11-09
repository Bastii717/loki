<script lang="ts">
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';
	import ArrowBigDown from 'lucide-svelte/icons/arrow-big-down';
	import ArrowBigUp from 'lucide-svelte/icons/arrow-big-up';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import Reply from 'lucide-svelte/icons/reply';
	import { apiErrorMessage } from '../api-error';
	import { countReplies, type CommentNode as TreeNode, type CommentSection } from '../comment-tree';
	import { splitMentions } from '../mentions';
	import type { CommentItem } from '../server/comments';
	import { relativeTime } from '../time';
	import { createVoter } from '../vote';
	import Avatar from './Avatar.svelte';
	import CommentComposer from './CommentComposer.svelte';
	import CommentNode from './CommentNode.svelte';
	import ReportButton from './ReportButton.svelte';
	import RoleBadge from './RoleBadge.svelte';
	import UnderReviewBadge from './UnderReviewBadge.svelte';

	/** One comment with its replies (recursive). Shared state and actions come from `section`. */
	let { node, section }: { node: TreeNode; section: CommentSection } = $props();

	const item = $derived(node.item);
	const mine = $derived(!item.deleted && item.authorId === section.viewer.id);
	const canDelete = $derived(!item.deleted && (mine || section.viewer.canModerate));
	// no votes on own comments, nor on text withheld for review; the score still shows
	const canVote = $derived(!item.deleted && !mine && item.text !== null);
	const parts = $derived(item.text === null ? [] : splitMentions(item.text));
	const replying = $derived(!item.deleted && section.replyingTo === item.id);
	const replyCount = $derived(countReplies(node));
	const userHref = (pid: string) => resolve('/users/[pid]', { pid });

	// Votes live here, not in the section's list, so Top does not reshuffle while someone votes.
	// Replies are hidden (not unmounted) when collapsed, so this state survives a collapse.
	// svelte-ignore state_referenced_locally
	let score = $state(node.item.score);
	// svelte-ignore state_referenced_locally
	let userVote = $state<-1 | 0 | 1>(node.item.userVote);
	const scoreLabel = $derived(score > 0 ? `+${score}` : String(score));
	let collapsed = $state(false);
	let error = $state('');
	let replyButton = $state<HTMLButtonElement>();
	let deleting = false;

	const vote = createVoter(
		() => `/api/comments/${item.id}/vote`,
		() => ({ score, userVote }),
		(s) => {
			score = s.score;
			userVote = s.userVote;
		},
		(message) => (error = message)
	);
	function castVote(dir: 1 | -1) {
		if (section.blocked((m) => (error = m))) return;
		error = '';
		void vote(dir);
	}

	function toggleReply() {
		if (replying) return section.openReply(null);
		if (section.blocked((m) => (error = m))) return;
		error = '';
		section.openReply(item.id);
	}

	async function closeReply() {
		section.openReply(null);
		await tick();
		replyButton?.focus();
	}

	function posted(c: CommentItem) {
		collapsed = false;
		section.posted(c);
		void closeReply();
	}

	async function remove() {
		if (deleting || section.blocked((m) => (error = m))) return;
		error = '';
		deleting = true;
		try {
			const res = await fetch(`/api/comments/${item.id}`, { method: 'DELETE' });
			// 404: already gone on the server, so drop it here too
			if (!res.ok && res.status !== 404) {
				error = await apiErrorMessage(res, 'Could not delete the comment.');
				return;
			}
			section.deleted(item.id);
		} catch {
			error = 'Could not delete the comment.';
		} finally {
			deleting = false;
		}
	}
</script>

<li id="c-{item.id}" class="comment">
	<div class="body" class:highlight={section.highlighted === item.id}>
		{#if item.deleted}
			<p class="tomb">[deleted]</p>
		{:else}
			<div class="head">
				<span class="author">
					<Avatar thumbKey={item.authorAvatar} name={item.author} size={24} />
					<b><a href={userHref(item.authorId)} class="name">{item.author}</a></b><RoleBadge
						role={item.authorRole}
					/>
				</span>
				<time datetime={item.createdAt}>{relativeTime(item.createdAt)}</time>
				<span class="actions">
					{#if canDelete}
						<button
							type="button"
							class="del"
							onclick={remove}
							aria-disabled={section.locked ? 'true' : undefined}
							title={section.lockTitle}
							aria-label="Delete comment by {item.author}">Delete</button
						>
					{/if}
					<ReportButton contentType="comment" contentId={item.id} {mine} />
				</span>
			</div>
			{#if item.text === null}
				<p class="review"><EyeOff size={14} aria-hidden="true" /> Under review</p>
			{:else}
				{#if item.underReview}<p class="review-note"><UnderReviewBadge /></p>{/if}
				<p class="text">
					{#each parts as part, i (i)}{#if part.kind === 'text'}{part.text}{:else if item.mentions[part.id] !== undefined}<a
								href={userHref(part.id)}
								class="mention">@{item.mentions[part.id]}</a
							>{:else}@unknown member{/if}{/each}
				</p>
			{/if}
		{/if}
		{#if !item.deleted || node.replies.length > 0}
			<div class="foot">
				{#if !item.deleted}
					<span class="votes" class:static={!canVote}>
						{#if canVote}<button
								type="button"
								class="arrow up"
								class:active={userVote === 1}
								aria-label="Upvote comment by {item.author}"
								aria-pressed={userVote === 1}
								aria-disabled={section.locked ? 'true' : undefined}
								title={section.lockTitle}
								onclick={() => castVote(1)}
								><ArrowBigUp
									size={18}
									fill={userVote === 1 ? 'currentColor' : 'none'}
									aria-hidden="true"
								/></button
							>{/if}
						<b class="score" class:pos={score > 0} class:neg={score < 0}
							><span class="sr-only">Score </span>{scoreLabel}</b
						>
						{#if canVote}<button
								type="button"
								class="arrow down"
								class:active={userVote === -1}
								aria-label="Downvote comment by {item.author}"
								aria-pressed={userVote === -1}
								aria-disabled={section.locked ? 'true' : undefined}
								title={section.lockTitle}
								onclick={() => castVote(-1)}
								><ArrowBigDown
									size={18}
									fill={userVote === -1 ? 'currentColor' : 'none'}
									aria-hidden="true"
								/></button
							>{/if}
					</span>
				{/if}
				{#if !item.deleted}
					<button
						type="button"
						class="link"
						bind:this={replyButton}
						aria-label="Reply to {item.author}"
						aria-expanded={replying}
						aria-disabled={section.locked ? 'true' : undefined}
						title={section.lockTitle}
						onclick={toggleReply}><Reply size={16} aria-hidden="true" /> Reply</button
					>
				{/if}
				{#if node.replies.length > 0}
					<button
						type="button"
						class="link"
						aria-expanded={!collapsed}
						aria-controls="r-{item.id}"
						onclick={() => (collapsed = !collapsed)}
					>
						{#if collapsed}
							<ChevronRight size={16} aria-hidden="true" />
							{replyCount === 0
								? 'Show replies'
								: `Show ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
						{:else}
							<ChevronDown size={16} aria-hidden="true" /> Hide replies
						{/if}
					</button>
				{/if}
			</div>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
	</div>
	{#if replying}
		<div class="reply-form">
			<CommentComposer
				mediaId={section.mediaId}
				replyTo={item.id}
				label="Reply to {item.author}"
				placeholder="Write a reply…"
				initialText={item.depth >= 3 ? `@${item.author} ` : ''}
				initialPicks={item.depth >= 3 ? [{ id: item.authorId, name: item.author }] : []}
				locked={section.locked}
				lockTitle={section.lockTitle}
				blocked={section.blocked}
				autofocus
				onposted={posted}
				oncancel={closeReply}
			/>
		</div>
	{/if}
	{#if node.replies.length > 0}
		<!-- level-3 replies are siblings, so a level-3 node never indents further -->
		<ul class="replies" class:flat={item.depth >= 3} id="r-{item.id}" hidden={collapsed}>
			{#each node.replies as reply (reply.item.id)}
				<CommentNode node={reply} {section} />
			{/each}
		</ul>
	{/if}
</li>

<style>
	.comment {
		/* deep links land below the sticky meme bar */
		scroll-margin-top: calc(var(--banners-height, 0px) + 64px);
	}

	.body {
		border-radius: 8px;
	}

	.highlight {
		animation: flash 3s ease-out;
	}

	@keyframes flash {
		from,
		30% {
			background: var(--accent-soft);
			box-shadow: 0 0 0 6px var(--accent-soft);
		}
		to {
			background: transparent;
			box-shadow: 0 0 0 6px transparent;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.highlight {
			animation: none;
			background: var(--accent-soft);
			box-shadow: 0 0 0 6px var(--accent-soft);
		}
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

	a.name:hover,
	a.mention:hover {
		text-decoration: underline;
	}

	a.name:focus-visible,
	a.mention:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 2px;
	}

	.mention {
		color: var(--accent-soft-text);
		font-weight: 600;
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

	p {
		margin: 4px 0 0;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.tomb,
	.review {
		color: var(--text-muted);
		font-style: italic;
	}

	.tomb {
		margin: 0;
		padding: 4px 0;
	}

	.review {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		margin-top: 2px;
		color: var(--text-muted);
		font-size: 13px;
	}

	.votes {
		display: inline-flex;
		align-items: center;
	}

	.votes.static {
		min-height: 32px;
		padding: 0 4px;
	}

	.arrow {
		width: 32px;
		height: 32px;
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
		min-width: 2ch;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	.score.pos {
		color: var(--up);
	}

	.score.neg {
		color: var(--down);
	}

	.link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 32px;
		padding: 0 4px;
		border: 0;
		background: none;
		color: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	.link:hover {
		color: var(--text);
	}

	[aria-disabled='true'] {
		opacity: 0.5;
	}

	.error {
		color: var(--down);
		font-size: 13px;
	}

	.reply-form {
		margin: 4px 0 8px;
	}

	/* ~16 px per level with a thread line; leaves room for text at 360 px */
	.replies {
		margin: 4px 0 0 4px;
		padding: 0 0 0 10px;
		border-left: 2px solid var(--border);
		list-style: none;
	}

	.replies.flat {
		margin-left: 0;
		padding-left: 0;
		border-left: 0;
	}

	.replies[hidden] {
		display: none;
	}

	.replies > :global(li) {
		padding-top: 8px;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
</style>
