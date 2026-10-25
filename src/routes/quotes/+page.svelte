<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import ArrowBigDown from 'lucide-svelte/icons/arrow-big-down';
	import ArrowBigUp from 'lucide-svelte/icons/arrow-big-up';
	import Check from 'lucide-svelte/icons/check';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import Send from 'lucide-svelte/icons/send';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import X from 'lucide-svelte/icons/x';
	import ReportButton from '../../lib/components/ReportButton.svelte';
	import UnderReviewBadge from '../../lib/components/UnderReviewBadge.svelte';
	import { apiErrorMessage } from '../../lib/api-error';
	import { lockMessage, useStatus } from '../../lib/status-context';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Local copy so votes update instantly; resynced whenever load data changes.
	let items = $derived(data.quotes);
	let confirmingId = $state<number | null>(null);
	let busy = $state(false);
	let failure = $state<string | null>(null);

	// While writes are locked the controls stay in the DOM (focusable, with the reason as title);
	// activating one shows the reason in the failure line instead of calling the API.
	const status = useStatus();
	const locked = $derived(!status.value.writable);
	const lockTitle = $derived(locked ? lockMessage(status.value) : undefined);
	function blocked(): boolean {
		if (!locked) return false;
		failure = lockMessage(status.value);
		return true;
	}

	async function vote(id: number, clicked: 1 | -1) {
		const q = items.find((x) => x.id === id);
		if (!q || busy || blocked()) return;
		busy = true;
		failure = null;
		const value = q.userVote === clicked ? 0 : clicked;
		try {
			const res = await fetch(`/api/quotes/${id}/vote`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ value })
			});
			if (!res.ok) {
				failure = await apiErrorMessage(res, 'Voting failed.');
				return;
			}
			const result: { score: number; userVote: 1 | -1 | 0 } = await res.json();
			items = items.map((x) => (x.id === id ? { ...x, ...result } : x));
		} catch {
			failure = 'Voting failed.';
		} finally {
			busy = false;
		}
	}

	async function remove(id: number) {
		if (blocked()) return;
		busy = true;
		failure = null;
		try {
			const res = await fetch(`/api/quotes/${id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 404) {
				failure = await apiErrorMessage(res, 'Deleting failed.');
				return;
			}
			confirmingId = null;
			await invalidateAll();
		} catch {
			failure = 'Deleting failed.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Quotes · Loki</title>
</svelte:head>

<main>
	<h1>Quotes</h1>

	<form
		method="POST"
		action="?/add"
		class="submit"
		use:enhance={({ cancel }) => {
			if (blocked()) cancel();
		}}
	>
		<textarea
			name="text"
			rows="3"
			maxlength={data.limits.text}
			placeholder="Quote"
			aria-label="Quote"
			required
			value={form?.text ?? ''}></textarea>
		<div class="row">
			<input
				name="author"
				maxlength={data.limits.author}
				placeholder="Who said that?"
				aria-label="Who said that?"
				required
				value={form?.author ?? ''}
			/>
			<button
				type="submit"
				class="send"
				aria-label="Add quote"
				aria-disabled={locked ? 'true' : undefined}
				title={lockTitle}><Send size={18} /></button
			>
		</div>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
	</form>

	{#if failure}<p class="error" role="alert">{failure}</p>{/if}

	{#if items.length === 0}
		<p class="empty">No quotes yet. Be the first!</p>
	{:else}
		<ul>
			{#each items as q (q.id)}
				<li class="card">
					<div class="body">
						{#if q.text === null}
							<p class="review"><EyeOff size={14} aria-hidden="true" /> Under review</p>
						{:else}
							{#if q.underReview}<UnderReviewBadge />{/if}
							<blockquote>“{q.text}”</blockquote>
							<p class="author">— {q.author}</p>
						{/if}
						{#if data.canModerate}
							{#if confirmingId === q.id}
								<div class="confirm">
									<span>Really delete this quote?</span>
									<button type="button" class="danger" disabled={busy} onclick={() => remove(q.id)}>
										<Check size={16} /> Delete
									</button>
									<button type="button" onclick={() => (confirmingId = null)}>
										<X size={16} /> Cancel
									</button>
								</div>
							{:else}
								<button
									type="button"
									class="icon"
									aria-label="Delete quote"
									aria-disabled={locked ? 'true' : undefined}
									title={lockTitle}
									onclick={() => (confirmingId = q.id)}
								>
									<Trash2 size={16} />
								</button>
							{/if}
						{/if}
					</div>
					<div class="votes">
						<ReportButton contentType="quote" contentId={q.id} mine={q.mine} />
						<button
							type="button"
							class="icon up"
							class:active={q.userVote === 1}
							aria-label="Upvote"
							aria-pressed={q.userVote === 1}
							disabled={busy}
							aria-disabled={locked ? 'true' : undefined}
							title={lockTitle}
							onclick={() => vote(q.id, 1)}
						>
							<ArrowBigUp size={22} />
						</button>
						<span class="score">{q.score}</span>
						<button
							type="button"
							class="icon down"
							class:active={q.userVote === -1}
							aria-label="Downvote"
							aria-pressed={q.userVote === -1}
							disabled={busy}
							aria-disabled={locked ? 'true' : undefined}
							title={lockTitle}
							onclick={() => vote(q.id, -1)}
						>
							<ArrowBigDown size={22} />
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		padding: var(--gutter);
		padding-bottom: calc(var(--tabbar-height) + var(--gutter));
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	h1 {
		margin: 0;
		font-size: 1.25rem;
	}
	.submit {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 10px;
	}
	.row {
		display: flex;
		gap: 8px;
	}
	textarea,
	input {
		font: inherit;
		color: var(--text);
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 8px 10px;
		min-width: 0;
		resize: vertical;
	}
	input {
		flex: 1;
	}
	.send {
		display: grid;
		place-items: center;
		width: 44px;
		border: none;
		border-radius: 8px;
		background: var(--accent);
		color: var(--accent-text);
		cursor: pointer;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.card {
		display: flex;
		gap: 10px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 12px;
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: flex-start;
	}
	blockquote {
		margin: 0;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
	.review {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		color: var(--text-muted);
		font-style: italic;
	}
	.author {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.875rem;
	}
	.votes {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}
	.score {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	button {
		font: inherit;
		color: var(--text);
		cursor: pointer;
	}
	[aria-disabled='true'] {
		opacity: 0.5;
	}

	.icon {
		display: grid;
		place-items: center;
		min-width: 40px;
		min-height: 40px;
		background: none;
		border: none;
		border-radius: var(--radius-pill);
		color: var(--text-muted);
	}
	.icon.up.active {
		color: var(--up);
	}
	.icon.down.active {
		color: var(--down);
	}
	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		font-size: 0.875rem;
	}
	.confirm button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 36px;
		padding: 0 10px;
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: 8px;
	}
	.confirm .danger {
		background: var(--down);
		border-color: var(--down);
		color: #fff;
	}
	.error {
		margin: 0;
		color: var(--down);
		font-size: 0.875rem;
	}
	.empty {
		color: var(--text-muted);
		text-align: center;
	}
</style>
