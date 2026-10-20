<script lang="ts">
	import MemeDetail from '#lib/components/MemeDetail.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.item.title || 'Meme'} · Loki</title>
</svelte:head>

<!-- keyed so swiping to another meme starts with fresh vote/comment/blur state -->
{#key data.item.id}
	<MemeDetail item={data.item} comments={data.comments} viewer={data.viewer} flags={data.flags} />
{/key}
