<script lang="ts">
	import SeasonEffect from '#lib/components/SeasonEffect.svelte';
	import { resolve } from '$app/paths';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Weekly column chart geometry (viewBox units; the svg scales to the card width).
	const W = 340;
	const H = 150;
	const PAD_TOP = 18;
	const PAD_BOTTOM = 22;
	const plotH = H - PAD_TOP - PAD_BOTTOM;

	const weekMax = $derived(Math.max(1, ...data.uploadsPerWeek.map((w) => w.count)));
	const slot = $derived(W / Math.max(1, data.uploadsPerWeek.length));
	const barW = $derived(Math.min(24, slot - 8));
	const weekBars = $derived(
		data.uploadsPerWeek.map((w, i) => {
			const h = w.count === 0 ? 0 : Math.max(3, (w.count / weekMax) * plotH);
			return {
				...w,
				x: i * slot + (slot - barW) / 2,
				cx: i * slot + slot / 2,
				y: PAD_TOP + plotH - h,
				h,
				label: w.week.replace(/^\d{4}-/, '')
			};
		})
	);

	const weekSummary = $derived(data.uploadsPerWeek.map((w) => `${w.week}: ${w.count}`).join(', '));

	const uploaderRows = $derived(
		data.topUploaders.map((u) => ({ label: u.username, value: u.count }))
	);
	const memeRows = $derived(
		data.topVoted.map((m) => ({
			label: m.title || 'Untitled',
			value: m.score,
			pid: m.id
		}))
	);
	const tagRows = $derived(data.topTags.map((t) => ({ label: `#${t.name}`, value: t.count })));

	function share(value: number, rows: { value: number }[]): number {
		const max = Math.max(1, ...rows.map((r) => r.value));
		return value <= 0 ? 0 : Math.max(2, (value / max) * 100);
	}
</script>

<svelte:head>
	<title>Stats · Loki</title>
</svelte:head>

{#snippet ranking(
	title: string,
	rows: { label: string; value: number; pid?: string }[],
	unit: string
)}
	<section class="card">
		<h2>{title}</h2>
		{#if rows.length === 0}
			<p class="empty">No data yet.</p>
		{:else}
			<ol class="rank">
				{#each rows as row, i (i)}
					<li>
						<div class="meta">
							{#if row.pid}
								<a class="label" href={resolve('/meme/[pid]', { pid: row.pid })}>{row.label}</a>
							{:else}
								<span class="label">{row.label}</span>
							{/if}
							<span class="value">{row.value}<span class="sr"> {unit}</span></span>
						</div>
						<svg class="bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
							<rect class="track" x="0" y="0" width="100" height="6" />
							<rect class="fill" x="0" y="0" width={share(row.value, rows)} height="6" />
						</svg>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
{/snippet}

<header class="top season-host">
	<SeasonEffect season={data.season?.id} />
	<a href={resolve('/profile')} class="back" aria-label="Back to profile"><ArrowLeft size={22} /></a
	>
	<h1>Stats</h1>
</header>

<main>
	<section class="card">
		<h2>Uploads per week</h2>
		<figure>
			<svg
				viewBox="0 0 {W} {H}"
				role="img"
				aria-label="Uploads per week, last 8 weeks. {weekSummary}"
			>
				<line class="base" x1="0" x2={W} y1={PAD_TOP + plotH} y2={PAD_TOP + plotH} />
				{#each weekBars as b (b.week)}
					{#if b.h > 0}
						<path
							class="col"
							d="M{b.x},{b.y + b.h} V{b.y + 4} a4,4 0 0 1 4,-4 h{barW - 8} a4,4 0 0 1 4,4 V{b.y +
								b.h} Z"
						>
							<title>{b.week}: {b.count} uploads</title>
						</path>
					{/if}
					{#if b.count > 0}
						<text class="val" x={b.cx} y={b.y - 5} text-anchor="middle">{b.count}</text>
					{/if}
					<text class="tick" x={b.cx} y={H - 6} text-anchor="middle">{b.label}</text>
				{/each}
			</svg>
			<table class="sr">
				<caption>Uploads per week</caption>
				<thead><tr><th>Week</th><th>Uploads</th></tr></thead>
				<tbody>
					{#each data.uploadsPerWeek as w (w.week)}
						<tr><td>{w.week}</td><td>{w.count}</td></tr>
					{/each}
				</tbody>
			</table>
		</figure>
	</section>

	{@render ranking('Top uploaders', uploaderRows, 'uploads')}
	{@render ranking('Top memes', memeRows, 'points')}
	{@render ranking('Top tags', tagRows, 'memes')}
</main>

<style>
	.top {
		position: sticky;
		/* below the status banner strip, when there is one */
		top: var(--banners-height, 0px);
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 8px;
		background: var(--bg);
	}

	.back {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		border-radius: var(--radius-pill);
		color: var(--text);
	}

	h1 {
		margin: 0;
		font-size: 20px;
	}

	main {
		display: grid;
		gap: 12px;
		max-width: 560px;
		margin: 0 auto;
		padding: 8px var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}

	.card {
		padding: 14px;
		border-radius: var(--radius);
		background: var(--surface);
	}

	h2 {
		margin: 0 0 10px;
		font-size: 15px;
		font-weight: 600;
	}

	figure {
		margin: 0;
	}

	svg {
		display: block;
		width: 100%;
		height: auto;
	}

	.base {
		stroke: var(--border);
		stroke-width: 1;
	}

	.col {
		fill: var(--accent);
	}

	.val {
		fill: var(--text);
		font-size: 11px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.tick {
		fill: var(--text-muted);
		font-size: 10px;
	}

	.rank {
		display: grid;
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.meta {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 4px;
		font-size: 14px;
	}

	.label {
		min-width: 0;
		overflow: hidden;
		color: var(--text);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	a.label {
		text-decoration: none;
	}

	.value {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.bar {
		height: 6px;
		border-radius: 3px;
		overflow: hidden;
	}

	.track {
		fill: var(--surface-raised);
	}

	.fill {
		fill: var(--accent);
	}

	.empty {
		margin: 0;
		color: var(--text-muted);
		font-size: 14px;
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
