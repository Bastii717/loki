<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Avatar from '#lib/components/Avatar.svelte';
	import RoleBadge from '#lib/components/RoleBadge.svelte';
	import { modRequest } from '../../../lib/moderation-client';
	import { formatDate, formatDateTime, ROLE_LABELS } from '../../../lib/moderation-labels';
	import { DISPLAY_NAME_MAX } from '../../../lib/profile-limits';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type ProfileAction = 'rename' | 'reset' | 'removeAvatar' | 'clearMotto';

	/** The card whose rename field is open, its draft, a running request and the last error. */
	let renaming = $state<number | null>(null);
	let draft = $state('');
	let busy = $state(false);
	let failure = $state<{ id: number; message: string } | null>(null);

	function startRename(id: number, current: string | null) {
		renaming = id;
		draft = current ?? '';
		failure = null;
	}

	/** Svelte action: puts the cursor in the rename field as soon as it appears. */
	function focusOnMount(node: HTMLInputElement) {
		node.focus();
	}

	async function run(id: number, action: ProfileAction) {
		if (busy) return;
		busy = true;
		failure = null;
		const result = await modRequest(`/api/moderation/users/${id}/profile`, 'POST', {
			action,
			displayName: action === 'rename' ? draft : undefined
		});
		busy = false;
		if (result.ok) {
			if (action === 'rename') renaming = null;
			// reload the list data: the server normalises the name, so show what it stored
			await invalidateAll();
		} else {
			failure = { id, message: result.message };
		}
	}
</script>

<svelte:head>
	<title>Users · Moderation · Loki</title>
</svelte:head>

<section class="card hint" aria-labelledby="removal-title">
	<h2 id="removal-title">Removal</h2>
	<p>
		Removing someone for good happens in Authentik: revoke the group membership and they can no
		longer sign in. Loki never locks accounts itself. The numbers below are there to inform that
		decision.
	</p>
</section>

<h2 class="list-title">All users ({data.users.length})</h2>
<ul class="list">
	{#each data.users as u (u.id)}
		<li class="card">
			<div class="head">
				<Avatar thumbKey={u.avatarThumbKey} name={u.displayName ?? u.username} size={32} />
				<strong>{u.displayName ?? u.username}</strong>
				{#if u.displayName}<span class="muted">({u.username})</span>{/if}
				<RoleBadge role={u.role} />
				<span class="pill" class:accent={u.role !== 'member'}>{ROLE_LABELS[u.role]}</span>
				{#if u.activeTimeout}<span class="pill timeout">muted</span>{/if}
			</div>
			{#if u.motto}<p class="muted motto">{u.motto}</p>{/if}
			<dl>
				<div>
					<dt>Memes</dt>
					<dd>{u.memes}</dd>
				</div>
				<div>
					<dt>Comments</dt>
					<dd>{u.comments}</dd>
				</div>
				<div>
					<dt>Quotes</dt>
					<dd>{u.quotes}</dd>
				</div>
				<div>
					<dt>Confirmed reports</dt>
					<dd>{u.confirmedReports}</dd>
				</div>
			</dl>
			<div class="actions">
				{#if renaming === u.id}
					<form
						class="rename"
						onsubmit={(e) => {
							e.preventDefault();
							void run(u.id, 'rename');
						}}
					>
						<label>
							<span class="sr-only">New display name for {u.username}</span>
							<input
								class="field"
								type="text"
								maxlength={DISPLAY_NAME_MAX}
								autocomplete="off"
								bind:value={draft}
								use:focusOnMount
							/>
						</label>
						<button type="submit" class="btn primary" disabled={busy}>Save</button>
						<button type="button" class="btn" disabled={busy} onclick={() => (renaming = null)}>
							Cancel
						</button>
					</form>
				{:else}
					<button type="button" class="btn" onclick={() => startRename(u.id, u.displayName)}>
						Rename
					</button>
				{/if}
				{#if u.displayName}
					<button type="button" class="btn" disabled={busy} onclick={() => run(u.id, 'reset')}>
						Reset name
					</button>
				{/if}
				{#if u.avatarThumbKey}
					<button
						type="button"
						class="btn"
						disabled={busy}
						onclick={() => run(u.id, 'removeAvatar')}
					>
						Remove avatar
					</button>
				{/if}
				{#if u.motto}
					<button type="button" class="btn" disabled={busy} onclick={() => run(u.id, 'clearMotto')}>
						Clear motto
					</button>
				{/if}
			</div>
			{#if failure?.id === u.id}<p class="error" role="alert">{failure.message}</p>{/if}
			{#if u.confirmedReports > 0}
				<p class="muted">
					in {u.confirmedCases}
					{u.confirmedCases === 1 ? 'case' : 'cases'}
				</p>
			{/if}
			{#if u.activeTimeout}
				<p class="active">
					Timeout until {formatDateTime(u.activeTimeout.until)}: {u.activeTimeout.reason}
					<span class="muted">(by {u.activeTimeout.setBy})</span>
				</p>
			{/if}
			{#if u.pastTimeouts.length > 0}
				<details>
					<summary>Past timeouts ({u.pastTimeouts.length})</summary>
					<ul class="past">
						{#each u.pastTimeouts as t, i (i)}
							<li>
								{formatDate(t.createdAt)} to {formatDate(t.until)}: {t.reason}
								<span class="muted">
									(by {t.setBy}{t.liftedAt ? `, lifted ${formatDate(t.liftedAt)}` : ''})
								</span>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		</li>
	{/each}
</ul>

<style>
	h2 {
		margin: 0;
		font-size: 16px;
	}

	.list-title {
		margin-top: 8px;
	}

	.hint p {
		margin: 0;
		font-size: 14px;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.head strong {
		overflow-wrap: anywhere;
	}

	.motto {
		margin: 0;
		font-size: 14px;
		overflow-wrap: anywhere;
	}

	.actions,
	.rename {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.rename label {
		flex: 1 1 160px;
	}

	.rename .field {
		min-height: 44px;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.pill.timeout {
		background: var(--down);
		color: #fff;
	}

	dl {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
		margin: 0;
	}

	dl div {
		padding: 6px;
		border-radius: 8px;
		background: var(--surface-raised);
		text-align: center;
	}

	dt {
		color: var(--text-muted);
		font-size: 11px;
	}

	dd {
		margin: 2px 0 0;
		font-size: 18px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.active {
		margin: 0;
		font-size: 14px;
		overflow-wrap: anywhere;
	}

	summary {
		min-height: 32px;
		color: var(--text-muted);
		font-size: 14px;
		cursor: pointer;
	}

	.past {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 6px 0 0;
		padding: 0;
		list-style: none;
		font-size: 14px;
		overflow-wrap: anywhere;
	}
</style>
