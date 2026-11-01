<script lang="ts">
	import SeasonEffect from '#lib/components/SeasonEffect.svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import CheckCheck from 'lucide-svelte/icons/check-check';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Settings from 'lucide-svelte/icons/settings';
	import Shield from 'lucide-svelte/icons/shield';
	import Avatar from '#lib/components/Avatar.svelte';
	import { formatDateTime } from '../../lib/moderation-labels';
	import {
		FILTER_LABELS,
		NOTIFICATION_CATEGORY,
		notificationText
	} from '../../lib/notification-labels';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const filters = ['all', 'activity', 'moderation'] as const;
	const EMPTY_DEFAULT = 'Nothing here yet. When someone comments on your memes, you will know.';
	const EMPTY_MODERATION = 'No moderation notices. Keep it that way.';

	// The chips and the pager are plain links, so the page works without script and the URL is shareable.
	const filterQuery = (f: (typeof filters)[number]) => (f === 'all' ? '' : `?filter=${f}`);
	const olderQuery = $derived(
		`?${data.filter === 'all' ? '' : `filter=${data.filter}&`}before=${data.items.at(-1)?.id}`
	);
</script>

<svelte:head>
	<title>Notifications · Loki</title>
</svelte:head>

<header class="top season-host">
	<SeasonEffect season={data.season?.id} />
	<h1>Notifications</h1>
	<div class="actions">
		{#if data.unread > 0}
			<!-- A successful submit invalidates all load data, so the list and the bell count refresh. -->
			<form method="POST" action="?/readAll" use:enhance>
				<button type="submit" class="btn">
					<CheckCheck size={16} aria-hidden="true" /> Mark all as read
				</button>
			</form>
		{/if}
		<a href={resolve('/profile/notifications')} class="gear" aria-label="Notification settings">
			<Settings size={20} aria-hidden="true" />
		</a>
	</div>
</header>

<main>
	<nav class="chips" aria-label="Filter notifications">
		{#each filters as f (f)}
			<a
				href="{resolve('/notifications')}{filterQuery(f)}"
				aria-current={data.filter === f ? 'page' : undefined}
			>
				{FILTER_LABELS[f]}
			</a>
		{/each}
	</nav>

	{#if data.items.length === 0}
		<p class="empty">{data.filter === 'moderation' ? EMPTY_MODERATION : EMPTY_DEFAULT}</p>
	{:else}
		<ul class="list">
			{#each data.items as item (item.id)}
				{@const category = NOTIFICATION_CATEGORY[item.kind]}
				{@const { text, excerpt } = notificationText(item)}
				<li class={['row', category, { unread: !item.read }]}>
					<form method="POST" action="?/open" use:enhance>
						<input type="hidden" name="id" value={item.id} />
						<input type="hidden" name="filter" value={data.filter} />
						<button type="submit">
							<span class="icon" aria-hidden="true">
								{#if category === 'moderation'}
									<Shield size={20} />
								{:else}
									<MessageCircle size={20} />
								{/if}
							</span>
							<span class="body">
								{#if !item.read}<span class="sr-only">Unread</span>{/if}
								<span class="text">{text}</span>
								{#if excerpt}<span class="excerpt">“{excerpt}”</span>{/if}
								<span class="meta">
									{#if category === 'activity' && item.actor}
										<Avatar thumbKey={item.actor.avatarThumbKey} name={item.actor.name} size={24} />
									{/if}
									<time datetime={item.updatedAt}>{formatDateTime(item.updatedAt)}</time>
								</span>
							</span>
						</button>
					</form>
				</li>
			{/each}
		</ul>

		{#if data.hasMore}
			<div class="pager"><a href="{resolve('/notifications')}{olderQuery}">Show older</a></div>
		{/if}
	{/if}
</main>

<style>
	.top {
		position: sticky;
		/* below the status banner strip, when there is one */
		top: var(--banners-height, 0px);
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		max-width: 560px;
		margin: 0 auto;
		padding: 6px var(--gutter);
		background: var(--bg);
	}

	h1 {
		margin: 0;
		font-size: 18px;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.gear {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: var(--radius-pill);
		color: var(--text);
	}

	main {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 560px;
		margin: 0 auto;
		padding: 4px var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}

	.chips {
		display: flex;
		gap: 4px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.chips a {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 14px;
		border-radius: var(--radius-pill);
		color: var(--text-muted);
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
	}

	.chips a[aria-current='page'] {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		overflow: hidden;
		border-radius: var(--radius);
		background: var(--surface);
	}

	.row.unread {
		background-image: linear-gradient(var(--accent-soft), var(--accent-soft));
	}

	.row.moderation {
		border-left: 3px solid var(--warn);
	}

	/* the whole row is the button, styled as a row */
	.row button {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: 12px;
		width: 100%;
		min-height: 44px;
		padding: 12px;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
	}

	.row button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.icon {
		display: flex;
		flex: none;
		padding-top: 1px;
	}

	.activity .icon {
		color: var(--accent);
	}

	.moderation .icon {
		color: var(--warn);
	}

	.body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.unread .text {
		font-weight: 600;
	}

	.excerpt {
		color: var(--text-muted);
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
		font-size: 12px;
	}

	form {
		margin: 0;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 14px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-raised);
		color: var(--text);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}

	.empty {
		margin: 24px 0;
		color: var(--text-muted);
		text-align: center;
	}

	.pager {
		display: flex;
		justify-content: center;
	}

	.pager a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		font-weight: 600;
	}
</style>
