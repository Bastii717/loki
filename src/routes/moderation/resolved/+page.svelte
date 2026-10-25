<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Inbox from 'lucide-svelte/icons/inbox';
	import {
		CATEGORY_LABELS,
		CONTENT_LABELS,
		formatDateTime,
		OUTCOME_LABELS,
		pluralize
	} from '../../../lib/moderation-labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const onLaterPage = $derived(page.url.searchParams.has('cursor'));
</script>

<svelte:head>
	<title>Erledigt · Moderation · Loki</title>
</svelte:head>

{#if data.cases.length === 0}
	<div class="empty">
		<Inbox size={36} aria-hidden="true" />
		<p>Noch nichts erledigt.</p>
	</div>
{:else}
	<ul class="list">
		{#each data.cases as c (c.contentType + ':' + c.contentId + ':' + c.resolvedAt)}
			<li class="card">
				<div class="head">
					<span class="pill accent">{CONTENT_LABELS[c.contentType]}</span>
					<span class="pill outcome {c.outcome}">{OUTCOME_LABELS[c.outcome]}</span>
					<span class="muted">{formatDateTime(c.resolvedAt)}, {c.resolvedBy}</span>
				</div>
				<p class="excerpt">{c.excerpt}</p>
				<p class="muted">
					von {c.author}, {pluralize(c.reports.length, 'Meldung', 'Meldungen')}:
					{c.categories.map((k) => `${CATEGORY_LABELS[k.category]} × ${k.count}`).join(', ')}
				</p>
				<details>
					<summary>Melder ({c.reports.length})</summary>
					<ul class="reporters">
						{#each c.reports as r, i (i)}
							<li>
								<strong>{r.reporter}</strong>
								<span class="muted">{CATEGORY_LABELS[r.category]}</span>
								{#if r.text}<p class="reporter-text">{r.text}</p>{/if}
							</li>
						{/each}
					</ul>
				</details>
			</li>
		{/each}
	</ul>
{/if}

{#if data.nextCursor !== null || onLaterPage}
	<nav class="pager" aria-label="Seiten">
		{#if onLaterPage}<a href={resolve('/moderation/resolved')}>Zum Anfang</a>{/if}
		{#if data.nextCursor !== null}
			<a href="{resolve('/moderation/resolved')}?cursor={data.nextCursor}">Ältere Fälle</a>
		{/if}
	</nav>
{/if}

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.outcome.actioned {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.excerpt {
		margin: 0;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	summary {
		min-height: 32px;
		color: var(--text-muted);
		font-size: 14px;
		cursor: pointer;
	}

	.reporters {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 6px 0 0;
		padding: 0;
		list-style: none;
		font-size: 14px;
	}

	.reporter-text {
		margin: 2px 0 0;
		padding-left: 10px;
		border-left: 2px solid var(--border);
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}
</style>
