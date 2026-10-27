<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ScrollText from 'lucide-svelte/icons/scroll-text';
	import RoleBadge from '#lib/components/RoleBadge.svelte';
	import {
		AUDIT_LABELS,
		CONTENT_LABELS,
		formatDateTime,
		modName
	} from '../../../lib/moderation-labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const onLaterPage = $derived(page.url.searchParams.has('cursor'));
	const firstQuery = $derived(data.action ? `?action=${encodeURIComponent(data.action)}` : '');
	const filterQuery = $derived(data.action ? `&action=${encodeURIComponent(data.action)}` : '');

	const target = (e: PageProps['data']['entries'][number]) =>
		e.targetType === 'user'
			? `User ${e.targetName ? modName(e.targetDisplay, e.targetName) : `#${e.targetId}`}`
			: e.targetType === 'site_content'
				? 'Site content'
				: `${CONTENT_LABELS[e.targetType as keyof typeof CONTENT_LABELS] ?? e.targetType} #${e.targetId}`;
</script>

<svelte:head>
	<title>Log · Moderation · Loki</title>
</svelte:head>

<form method="GET" class="filter">
	<label>
		Action
		<select name="action" class="field" value={data.action}>
			<option value="">All actions</option>
			{#each data.actions as a (a)}
				<option value={a}>{AUDIT_LABELS[a] ?? a}</option>
			{/each}
		</select>
	</label>
	<button type="submit" class="btn">Filter</button>
</form>

{#if data.entries.length === 0}
	<div class="empty">
		<ScrollText size={36} aria-hidden="true" />
		<p>No entries.</p>
	</div>
{:else}
	<ul class="list">
		{#each data.entries as e (e.id)}
			<li class="card">
				<div class="head">
					<span class="pill accent">{AUDIT_LABELS[e.action] ?? e.action}</span>
					<span class="muted">{formatDateTime(e.createdAt)}</span>
				</div>
				<p class="line">
					<strong>{e.actor}</strong>: {target(e)}
					{#if e.targetRole}<RoleBadge role={e.targetRole} />{/if}
				</p>
				{#if e.detail}<p class="detail">{e.detail}</p>{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if data.nextCursor !== null || onLaterPage}
	<nav class="pager" aria-label="Pages">
		{#if onLaterPage}
			<a href="{resolve('/moderation/log')}{firstQuery}">Back to start</a>
		{/if}
		{#if data.nextCursor !== null}
			<a href="{resolve('/moderation/log')}?cursor={data.nextCursor}{filterQuery}">Older entries</a>
		{/if}
	</nav>
{/if}

<style>
	.filter {
		display: flex;
		align-items: flex-end;
		gap: 8px;
	}

	label {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.line,
	.detail {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.detail {
		color: var(--text-muted);
		font-size: 14px;
		white-space: pre-wrap;
	}
</style>
