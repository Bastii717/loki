<script lang="ts">
	import Shield from 'lucide-svelte/icons/shield';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import type { FeedItem } from '../server/feed';

	/** Marks staff next to a name: a shield for moderators, a checked shield for admins, nothing for members. */
	let { role }: { role: FeedItem['uploaderRole'] } = $props();
</script>

{#if role === 'moderator'}
	<span class="role" role="img" aria-label="Moderator"><Shield size={14} aria-hidden="true" /></span
	>
{:else if role === 'admin'}
	<span class="role" role="img" aria-label="Admin"
		><ShieldCheck size={14} aria-hidden="true" /></span
	>
{/if}

<style>
	.role {
		display: inline-flex;
		flex: none;
		align-items: center;
		color: var(--accent);
	}
</style>
