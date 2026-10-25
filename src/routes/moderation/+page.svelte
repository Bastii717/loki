<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import CaseCard from './CaseCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const onLaterPage = $derived(page.url.searchParams.has('cursor'));
</script>

<svelte:head>
	<title>Queue · Moderation · Loki</title>
</svelte:head>

{#if data.cases.length === 0}
	<div class="empty">
		<ShieldCheck size={36} aria-hidden="true" />
		<p>No open reports. All quiet.</p>
	</div>
{:else}
	<p class="muted">Oldest cases first. You always see reported content in full.</p>
	<ul class="list">
		{#each data.cases as item (item.contentType + ':' + item.contentId)}
			<li><CaseCard {item} viewer={data.viewer} /></li>
		{/each}
	</ul>
{/if}

{#if data.nextCursor !== null || onLaterPage}
	<nav class="pager" aria-label="Pages">
		{#if onLaterPage}<a href={resolve('/moderation')}>Back to start</a>{/if}
		{#if data.nextCursor !== null}
			<a href="{resolve('/moderation')}?cursor={data.nextCursor}">More cases</a>
		{/if}
	</nav>
{/if}
