<script lang="ts">
	import { formatDate, formatDateTime, ROLE_LABELS } from '../../../lib/moderation-labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
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
				<strong>{u.username}</strong>
				<span class="pill" class:accent={u.role !== 'member'}>{ROLE_LABELS[u.role]}</span>
				{#if u.activeTimeout}<span class="pill timeout">muted</span>{/if}
			</div>
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
