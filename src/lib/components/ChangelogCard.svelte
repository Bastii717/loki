<script lang="ts">
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import X from 'lucide-svelte/icons/x';
	import { onMount } from 'svelte';
	import { CHANGELOG, type ChangelogEntry } from '../changelog';

	const KEY = 'loki.changelog.dismissed';

	let { entry = CHANGELOG[0] }: { entry?: ChangelogEntry | null } = $props();

	// Decided after mount only: localStorage does not exist during SSR.
	let visible = $state(false);

	onMount(() => {
		let dismissed: string | null = null;
		try {
			dismissed = localStorage.getItem(KEY);
		} catch {
			// storage blocked: show the card
		}
		visible = !!entry && dismissed !== entry.id;
	});

	function dismiss() {
		visible = false;
		if (!entry) return;
		try {
			localStorage.setItem(KEY, entry.id);
		} catch {
			// storage blocked: the card returns on next load
		}
	}
</script>

{#if visible && entry}
	<section class="changelog" aria-label="What's new">
		<Sparkles class="sparkle" size={17} aria-hidden="true" />
		<div class="body">
			<h2 class="title">New in Loki</h2>
			<ul>
				{#each entry.lines as line, i (i)}
					<li>{line}</li>
				{/each}
			</ul>
		</div>
		<button type="button" class="dismiss" aria-label="Dismiss" onclick={dismiss}>
			<X size={16} aria-hidden="true" />
		</button>
	</section>
{/if}

<style>
	.changelog {
		position: relative;
		display: flex;
		gap: 10px;
		margin: 0 0 12px;
		padding: 12px 44px 12px 12px;
		border: 1px solid rgba(88, 101, 242, 0.45);
		border-radius: var(--radius);
		background:
			linear-gradient(135deg, rgba(88, 101, 242, 0.18), rgba(88, 101, 242, 0.05)), var(--surface);
		color: var(--text);
	}

	.changelog :global(.sparkle) {
		flex: none;
		margin-top: 1px;
		color: #aab4ff;
	}

	.body {
		min-width: 0;
	}

	.title {
		margin: 0 0 6px;
		font-size: 14px;
		font-weight: 700;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		position: relative;
		padding-left: 14px;
		font-size: 13.5px;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	li + li {
		margin-top: 4px;
	}

	li::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0.55em;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent);
	}

	.dismiss {
		position: absolute;
		top: 6px;
		right: 6px;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border: 0;
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}

	.dismiss:hover {
		background: var(--accent-soft);
		color: var(--text);
	}
</style>
