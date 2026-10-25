<script lang="ts">
	import ContentPage from './ContentPage.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<ContentPage title="Regeln" {data} {form} />
