<script lang="ts">
	import ContentPage from '../rules/ContentPage.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<ContentPage title="FAQ" {data} {form} />
