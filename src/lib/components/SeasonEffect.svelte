<script lang="ts">
	import { EFFECT_BY_SEASON, particlesFor } from '../season-effects';
	import type { SeasonId } from '../seasons';

	/**
	 * Seasonal particles behind a page header: snow, bats, confetti or sparkles. Place it as the
	 * first child of a header that carries the `season-host` class (app.css): it fills the header,
	 * sits above its background and below its content, and is clipped to it, so it never covers
	 * a meme, a button or text, and clicks pass through.
	 */
	let { season }: { season: SeasonId | null | undefined } = $props();

	const kind = $derived(season ? EFFECT_BY_SEASON[season] : null);
	const particles = $derived(kind ? particlesFor(kind) : []);
	// bats cross the whole header, so their travel is relative to the viewport width
	const unit = $derived(kind === 'bats' ? 'vw' : 'px');
</script>

{#if kind}
	<div class="season-fx {kind}" data-effect={kind} aria-hidden="true">
		{#each particles as p, i (i)}
			<i
				style:left="{p.left}%"
				style:--s="{p.size}px"
				style:--drift="{p.drift}{unit}"
				style:--spin="{p.spin}deg"
				style:--rest="{p.rest}%"
				style:--c={p.color || undefined}
				style:animation-duration="{p.duration}s{kind === 'bats' ? ', 0.32s' : ''}"
				style:animation-delay="{p.delay}s"
			></i>
		{/each}
	</div>
{/if}

<style>
	.season-fx {
		position: absolute;
		inset: 0;
		/* above the header's own background, below its content (the header is a stacking context) */
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
		/* fade out towards the bottom edge of the header */
		-webkit-mask-image: linear-gradient(#000 55%, transparent);
		mask-image: linear-gradient(#000 55%, transparent);
	}

	i {
		position: absolute;
		top: -14px;
		animation-name: fall;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
		will-change: transform;
	}

	@keyframes fall {
		to {
			transform: translate3d(var(--drift), 120px, 0) rotate(var(--spin));
		}
	}

	.snow i {
		width: var(--s);
		height: var(--s);
		border-radius: 50%;
		background: var(--fx-snow, #fff);
		opacity: 0.75;
	}

	.confetti i {
		width: calc(var(--s) * 0.9);
		height: calc(var(--s) * 1.8);
		border-radius: 1px;
		background: var(--c);
		opacity: 0.9;
	}

	.sparkles i {
		width: calc(var(--s) * 2);
		height: calc(var(--s) * 2);
		background: var(--c);
		clip-path: polygon(50% 0, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0 50%, 39% 39%);
		opacity: 0.9;
	}

	.bats i {
		top: var(--rest);
		width: calc(var(--s) * 3.4);
		height: calc(var(--s) * 1.7);
		background: var(--fx-bat, #0b0910);
		filter: drop-shadow(0 0 3px var(--accent));
		animation-name: fly, flap;
		animation-timing-function: linear, ease-in-out;
		animation-direction: normal, alternate;
		clip-path: polygon(
			0 30%,
			20% 0,
			35% 35%,
			50% 15%,
			65% 35%,
			80% 0,
			100% 30%,
			70% 60%,
			50% 100%,
			30% 60%
		);
	}

	@keyframes fly {
		25% {
			transform: translate3d(calc(var(--drift) * 0.25), -5px, 0);
		}
		50% {
			transform: translate3d(calc(var(--drift) * 0.5), 3px, 0);
		}
		75% {
			transform: translate3d(calc(var(--drift) * 0.75), -4px, 0);
		}
		to {
			transform: translate3d(var(--drift), 0, 0);
		}
	}

	/* wings up and down: same point count, so the browser interpolates the shape */
	@keyframes flap {
		to {
			clip-path: polygon(
				0 70%,
				20% 45%,
				35% 40%,
				50% 15%,
				65% 40%,
				80% 45%,
				100% 70%,
				70% 65%,
				50% 100%,
				30% 65%
			);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		i {
			animation: none;
			top: var(--rest);
		}

		/* parked part-way across instead of waiting off-screen */
		.bats i {
			top: var(--rest);
			transform: translate3d(calc(var(--drift) * 0.45), 0, 0);
		}
	}
</style>
