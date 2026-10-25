<script lang="ts">
	import { onMount } from 'svelte';
	import Moon from 'lucide-svelte/icons/moon';
	import Sun from 'lucide-svelte/icons/sun';
	import { currentTheme, setTheme, type Theme } from '../theme';

	// Unknown until mounted: the server cannot know the OS preference or the stored choice.
	let theme = $state<Theme | null>(null);
	onMount(() => {
		theme = currentTheme();
	});

	function toggle() {
		const next: Theme = (theme ?? currentTheme()) === 'dark' ? 'light' : 'dark';
		setTheme(next);
		theme = next;
	}
</script>

<button
	type="button"
	class="theme"
	aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
	onclick={toggle}
>
	{#if theme === 'light'}
		<Moon size={18} aria-hidden="true" />
	{:else}
		<Sun size={18} aria-hidden="true" />
	{/if}
</button>

<style>
	.theme {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		padding: 0;
		border: 0;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--text-muted);
		cursor: pointer;
	}
</style>
