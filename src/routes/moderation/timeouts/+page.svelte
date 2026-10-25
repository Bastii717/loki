<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Search from 'lucide-svelte/icons/search';
	import Timer from 'lucide-svelte/icons/timer';
	import X from 'lucide-svelte/icons/x';
	import { modRequest } from '../../../lib/moderation-client';
	import { formatDateTime, ROLE_LABELS } from '../../../lib/moderation-labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	interface Candidate {
		id: number;
		username: string;
		role: string;
		timeoutable: boolean;
	}

	let query = $state('');
	let candidates = $state<Candidate[]>([]);
	let searched = $state(false);
	let selected = $state<Candidate | null>(null);
	let days = $state(3);
	let reason = $state('');
	let busy = $state(false);
	let failure = $state('');
	let success = $state('');
	let liftFailure = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;
	let searchSeq = 0;

	async function search() {
		const seq = ++searchSeq;
		try {
			const res = await fetch(`/api/moderation/users?q=${encodeURIComponent(query.trim())}`);
			if (!res.ok || seq !== searchSeq) return;
			candidates = ((await res.json()) as { users: Candidate[] }).users;
			searched = true;
		} catch {
			// keep the previous list
		}
	}

	function onInput() {
		clearTimeout(timer);
		timer = setTimeout(search, 250);
	}

	function pick(c: Candidate) {
		selected = c;
		failure = '';
		success = '';
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!selected || busy) return;
		busy = true;
		failure = '';
		success = '';
		const result = await modRequest('/api/moderation/timeouts', 'POST', {
			userId: selected.id,
			days,
			reason
		});
		busy = false;
		if (result.ok) {
			success = `${selected.username} is muted for ${days} ${days === 1 ? 'day' : 'days'}.`;
			selected = null;
			reason = '';
			query = '';
			candidates = [];
			searched = false;
			await invalidateAll();
		} else {
			failure = result.message;
		}
	}

	async function lift(userId: number) {
		liftFailure = '';
		const result = await modRequest(`/api/moderation/timeouts/${userId}`, 'DELETE');
		if (result.ok) await invalidateAll();
		else liftFailure = result.message;
	}
</script>

<svelte:head>
	<title>Timeouts · Moderation · Loki</title>
</svelte:head>

<section class="card" aria-labelledby="set-title">
	<h2 id="set-title">Set timeout</h2>
	<p class="muted">
		Muted users can read but not post, comment, report or vote. A new timeout replaces a running
		one.
	</p>

	<form onsubmit={submit}>
		{#if selected}
			<div class="chosen">
				<span><strong>{selected.username}</strong> ({ROLE_LABELS[selected.role]})</span>
				<button
					type="button"
					class="clear"
					aria-label="Clear selection"
					onclick={() => (selected = null)}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</div>
		{:else}
			<label>
				Search user
				<span class="search">
					<Search size={16} aria-hidden="true" />
					<input
						class="field"
						type="search"
						autocomplete="off"
						placeholder="Enter a name"
						bind:value={query}
						oninput={onInput}
						onfocus={() => !searched && search()}
					/>
				</span>
			</label>
			{#if searched}
				{#if candidates.length === 0}
					<p class="muted">Nobody found.</p>
				{:else}
					<ul class="results" aria-label="Search results">
						{#each candidates as c (c.id)}
							<li>
								<button type="button" disabled={!c.timeoutable} onclick={() => pick(c)}>
									<span>{c.username}</span>
									<span class="pill">{ROLE_LABELS[c.role]}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		{/if}

		<div class="duration">
			<label>
				Days (1 to {data.limits.days})
				<input
					class="field"
					type="number"
					min="1"
					max={data.limits.days}
					step="1"
					required
					bind:value={days}
				/>
			</label>
			<div class="presets" role="group" aria-label="Quick duration">
				{#each [1, 3, 7, 14, 30] as d (d)}
					<button type="button" class="pill" class:accent={days === d} onclick={() => (days = d)}>
						{d}
						{d === 1 ? 'day' : 'days'}
					</button>
				{/each}
			</div>
		</div>

		<label>
			Reason (shown to the user)
			<textarea class="field" rows="2" maxlength={data.limits.reason} required bind:value={reason}
			></textarea>
		</label>

		{#if failure}<p class="error" role="alert">{failure}</p>{/if}
		{#if success}<p class="ok" role="status">{success}</p>{/if}

		<button type="submit" class="btn danger" disabled={!selected || busy}>
			<Timer size={16} aria-hidden="true" /> Set timeout
		</button>
	</form>
</section>

<h2 class="list-title">Active timeouts ({data.timeouts.length})</h2>
{#if liftFailure}<p class="error" role="alert">{liftFailure}</p>{/if}
{#if data.timeouts.length === 0}
	<p class="muted">Nobody is muted right now.</p>
{:else}
	<ul class="list">
		{#each data.timeouts as t (t.id)}
			<li class="card">
				<div class="head">
					<strong>{t.username}</strong>
					<span class="pill">{ROLE_LABELS[t.role]}</span>
				</div>
				<p class="reason">{t.reason}</p>
				<p class="muted">
					until {formatDateTime(t.until)}, set by {t.setBy} on {formatDateTime(t.createdAt)}
				</p>
				{#if t.canLift}
					<button type="button" class="btn" onclick={() => lift(t.userId)}>Lift</button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	h2 {
		margin: 0;
		font-size: 16px;
	}

	.list-title {
		margin-top: 8px;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--text-muted);
	}

	.results {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}

	.results li + li {
		border-top: 1px solid var(--border);
	}

	.results button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		min-height: 44px;
		padding: 0 12px;
		border: none;
		background: var(--surface-raised);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}

	.results button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.chosen {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 6px 6px 6px 12px;
		border-radius: 8px;
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.clear {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border: none;
		background: none;
		color: inherit;
		cursor: pointer;
	}

	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}

	.presets .pill {
		min-height: 32px;
		border: none;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.reason {
		margin: 0;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
</style>
