<script lang="ts">
	import Ghost from 'lucide-svelte/icons/ghost';
	import PartyPopper from 'lucide-svelte/icons/party-popper';
	import Snowflake from 'lucide-svelte/icons/snowflake';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import type { Season } from '../seasons';

	let { icon, label, size = 18 }: { icon: Season['icon']; label: string; size?: number } = $props();

	const icons = {
		ghost: Ghost,
		snowflake: Snowflake,
		'party-popper': PartyPopper,
		sparkles: Sparkles
	};
	const Icon = $derived(icons[icon]);
</script>

<!-- Decorative: the tooltip names the season, assistive tech skips it. -->
<span class="season-icon" aria-hidden="true" title={label}>
	<Icon {size} />
</span>

<style>
	.season-icon {
		display: inline-flex;
		align-items: center;
		color: var(--accent);
	}
</style>
