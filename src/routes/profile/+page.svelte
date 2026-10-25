<script lang="ts">
	import { resolve } from '$app/paths';
	import BookOpen from 'lucide-svelte/icons/book-open';
	import ChartColumn from 'lucide-svelte/icons/chart-column';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import CircleQuestionMark from 'lucide-svelte/icons/circle-question-mark';
	import Images from 'lucide-svelte/icons/images';
	import LogOut from 'lucide-svelte/icons/log-out';
	import Shield from 'lucide-svelte/icons/shield';
	import Star from 'lucide-svelte/icons/star';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const roleLabel: Record<string, string> = {
		member: 'Member',
		moderator: 'Moderator',
		admin: 'Admin'
	};

	// Personal lists first, then the reference pages; Moderation is appended below for moderators.
	const links = [
		{ href: '/profile/memes', label: 'My memes', icon: Images },
		{ href: '/profile/favorites', label: 'Favorites', icon: Star },
		{ href: '/profile/stats', label: 'Stats', icon: ChartColumn },
		{ href: '/rules', label: 'Rules', icon: BookOpen },
		{ href: '/faq', label: 'FAQ', icon: CircleQuestionMark }
	] as const;
</script>

<svelte:head>
	<title>Profile · Loki</title>
</svelte:head>

<main>
	<header>
		<h1>{data.profile.username}</h1>
		<span class="role {data.profile.role}">{roleLabel[data.profile.role]}</span>
	</header>

	<dl class="counts">
		<div>
			<dt>Memes</dt>
			<dd>{data.counts.memes}</dd>
		</div>
		<div>
			<dt>Favorites</dt>
			<dd>{data.counts.favorites}</dd>
		</div>
		<div>
			<dt>Comments</dt>
			<dd>{data.counts.comments}</dd>
		</div>
	</dl>

	<nav aria-label="Profile">
		<ul>
			{#each links as link (link.href)}
				<li>
					<a href={resolve(link.href as '/')}>
						<link.icon size={20} aria-hidden="true" />
						<span>{link.label}</span>
						<ChevronRight size={18} aria-hidden="true" />
					</a>
				</li>
			{/each}
			{#if data.openCases !== null}
				<li>
					<a href={resolve('/moderation')}>
						<Shield size={20} aria-hidden="true" />
						<span>Moderation</span>
						{#if data.openCases > 0}
							<span class="cases" aria-label="{data.openCases} open cases">{data.openCases}</span>
						{/if}
						<ChevronRight size={18} aria-hidden="true" />
					</a>
				</li>
			{/if}
		</ul>
	</nav>

	<form method="POST" action="/logout">
		<button type="submit"><LogOut size={18} aria-hidden="true" /> Sign out</button>
	</form>
</main>

<style>
	main {
		max-width: 560px;
		margin: 0 auto;
		padding: 16px var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}

	header {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	h1 {
		margin: 0;
		font-size: 22px;
		overflow-wrap: anywhere;
	}

	.role {
		padding: 2px 10px;
		border-radius: var(--radius-pill);
		background: var(--surface-raised);
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 600;
	}

	.role.moderator,
	.role.admin {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.counts {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin: 16px 0;
	}

	.counts div {
		padding: 10px;
		border-radius: var(--radius);
		background: var(--surface);
		text-align: center;
	}

	dt {
		color: var(--text-muted);
		font-size: 12px;
	}

	dd {
		margin: 2px 0 0;
		font-size: 20px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	li + li {
		border-top: 1px solid var(--border);
	}

	li a {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		padding: 0 14px;
	}

	li a span {
		flex: 1;
	}

	li a .cases {
		flex: none;
		min-width: 22px;
		padding: 0 7px;
		border-radius: var(--radius-pill);
		background: var(--down);
		color: #fff;
		font-size: 12px;
		font-weight: 700;
		line-height: 22px;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	li a :global(svg:last-child) {
		color: var(--text-muted);
	}

	form {
		margin-top: 16px;
	}

	form button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		min-height: 48px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: none;
		color: var(--down);
		font-weight: 600;
		cursor: pointer;
	}
</style>
