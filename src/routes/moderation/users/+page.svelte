<script lang="ts">
	import { formatDate, formatDateTime, ROLE_LABELS } from '../../../lib/moderation-labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Nutzer · Moderation · Loki</title>
</svelte:head>

<section class="card hint" aria-labelledby="kick-title">
	<h2 id="kick-title">Rauswurf</h2>
	<p>
		Wer dauerhaft nicht mehr dabei sein soll, fliegt über Authentik raus: Gruppenmitgliedschaft
		entziehen, danach kann sich die Person nicht mehr anmelden. Loki sperrt keine Konten selbst. Die
		Zahlen unten sind die Entscheidungsgrundlage.
	</p>
</section>

<h2 class="list-title">Alle Nutzer ({data.users.length})</h2>
<ul class="list">
	{#each data.users as u (u.id)}
		<li class="card">
			<div class="head">
				<strong>{u.username}</strong>
				<span class="pill" class:accent={u.role !== 'member'}>{ROLE_LABELS[u.role]}</span>
				{#if u.activeTimeout}<span class="pill timeout">stummgeschaltet</span>{/if}
			</div>
			<dl>
				<div>
					<dt>Memes</dt>
					<dd>{u.memes}</dd>
				</div>
				<div>
					<dt>Kommentare</dt>
					<dd>{u.comments}</dd>
				</div>
				<div>
					<dt>Quotes</dt>
					<dd>{u.quotes}</dd>
				</div>
				<div>
					<dt>Bestätigte Meldungen</dt>
					<dd>{u.confirmedReports}</dd>
				</div>
			</dl>
			{#if u.confirmedReports > 0}
				<p class="muted">
					in {u.confirmedCases}
					{u.confirmedCases === 1 ? 'Fall' : 'Fällen'}
				</p>
			{/if}
			{#if u.activeTimeout}
				<p class="active">
					Timeout bis {formatDateTime(u.activeTimeout.until)}: {u.activeTimeout.reason}
					<span class="muted">(von {u.activeTimeout.setBy})</span>
				</p>
			{/if}
			{#if u.pastTimeouts.length > 0}
				<details>
					<summary>Frühere Timeouts ({u.pastTimeouts.length})</summary>
					<ul class="past">
						{#each u.pastTimeouts as t, i (i)}
							<li>
								{formatDate(t.createdAt)} bis {formatDate(t.until)}: {t.reason}
								<span class="muted">
									(von {t.setBy}{t.liftedAt ? `, aufgehoben ${formatDate(t.liftedAt)}` : ''})
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
