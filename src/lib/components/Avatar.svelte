<script lang="ts">
	/**
	 * A member's picture, or a letter circle when there is none. Decorative: the name is conveyed by
	 * the surrounding text, so the image has an empty alt and the letter is hidden from screen readers.
	 * `thumbKey` (64 px) serves small sizes, `key` (256 px) the large ones; either may be missing.
	 */
	let {
		thumbKey = null,
		key = null,
		name,
		size
	}: { thumbKey?: string | null; key?: string | null; name: string; size: number } = $props();

	// Stable per name, so a member keeps one colour everywhere. Fixed lightness keeps white text legible.
	const hue = $derived(
		[...name.normalize('NFC')].reduce((h, c) => (h * 31 + c.codePointAt(0)!) % 360, 7)
	);
	const letter = $derived([...name.normalize('NFC')][0]?.toUpperCase() ?? '?');
	const src = $derived(size > 64 ? (key ?? thumbKey) : (thumbKey ?? key));
</script>

{#if src}
	<img
		class="avatar"
		src="/media/{src}"
		alt=""
		width={size}
		height={size}
		loading="lazy"
		style="--size: {size}px"
	/>
{:else}
	<span class="avatar letter" aria-hidden="true" style="--size: {size}px; --hue: {hue}">
		{letter}
	</span>
{/if}

<style>
	.avatar {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: var(--size);
		height: var(--size);
		border-radius: 50%;
		background: var(--surface-raised);
		object-fit: cover;
		user-select: none;
	}

	.letter {
		background: hsl(var(--hue) 45% 38%);
		color: #fff;
		font-size: calc(var(--size) * 0.45);
		font-weight: 700;
		line-height: 1;
	}
</style>
