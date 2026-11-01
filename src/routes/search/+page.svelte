<script lang="ts">
	import SeasonEffect from '#lib/components/SeasonEffect.svelte';
	import { resolve } from '$app/paths';
	import Search from 'lucide-svelte/icons/search';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import Avatar from '#lib/components/Avatar.svelte';
	import MemeCard from '#lib/components/MemeCard.svelte';
	import RoleBadge from '#lib/components/RoleBadge.svelte';
	import { formatDateTime } from '../../lib/moderation-labels';
	import { highlight, PAGE_SIZE, PREVIEW, TOTAL_CAP, type SearchType } from '../../lib/search-view';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const chips: { type: SearchType; label: string }[] = [
		{ type: 'all', label: 'All' },
		{ type: 'memes', label: 'Memes' },
		{ type: 'tags', label: 'Tags' },
		{ type: 'people', label: 'People' },
		{ type: 'comments', label: 'Comments' },
		{ type: 'quotes', label: 'Quotes' }
	];

	// Chips and pager are plain links, so the page works without script and the URL is shareable.
	// They carry the text without its # or @ prefix, so a chip can switch to another section.
	const query = (type: SearchType, page = 1) => {
		const params = new SvelteURLSearchParams({ q: data.text });
		if (type !== 'all') params.set('type', type);
		if (page > 1) params.set('page', String(page));
		return `?${params}`;
	};

	const sections = $derived(data.sections);
	const typed = $derived(data.type !== 'all');
	const memeIds = $derived(sections.memes?.items.map((m) => m.id));
	const nothing = $derived(
		!sections.memes?.items.length &&
			!sections.tags?.length &&
			!sections.people?.items.length &&
			!sections.comments?.items.length &&
			!sections.quotes?.items.length
	);
</script>

<svelte:head>
	<title>Search · Loki</title>
</svelte:head>

<!-- All view: "Show all <total>" when a section has more than the preview; typed view: "Show more" while results are left beyond this page. -->
{#snippet pager(type: SearchType, total: number | null)}
	{#if typed}
		{#if type !== 'tags' && total !== null && total > data.page * PAGE_SIZE}
			<div class="pager">
				<a href="{resolve('/search')}{query(type, data.page + 1)}">Show more</a>
			</div>
		{/if}
	{:else if total !== null && total > PREVIEW}
		<div class="pager">
			<a href="{resolve('/search')}{query(type)}"
				>Show all {total === TOTAL_CAP ? `${total}+` : total}</a
			>
		</div>
	{/if}
{/snippet}

<header class="top season-host">
	<SeasonEffect season={data.season?.id} />
	<h1>Search</h1>
</header>

<main>
	<form method="GET" action={resolve('/search')} class="form" role="search">
		<!-- svelte-ignore a11y_autofocus -->
		<input
			type="search"
			name="q"
			value={data.q}
			placeholder="Memes, #tags, @people, comments, quotes"
			aria-label="Search"
			autocomplete="off"
			autofocus={!data.q}
		/>
		<button type="submit" class="submit" aria-label="Submit search"
			><Search size={20} aria-hidden="true" /></button
		>
	</form>

	{#if data.text !== ''}
		<nav class="chips" aria-label="Search in">
			{#each chips as chip (chip.type)}
				<a
					href="{resolve('/search')}{query(chip.type)}"
					aria-current={data.type === chip.type ? 'page' : undefined}
				>
					{chip.label}
				</a>
			{/each}
		</nav>
	{/if}

	{#if data.tooShort}
		<p class="empty">Type at least 2 characters.</p>
	{:else if data.text === ''}
		<p class="empty">Search memes, tags, people, comments and quotes.</p>
	{:else if nothing}
		<p class="empty">Nothing found for “{data.q}”. Try fewer letters or a tag.</p>
	{:else}
		{#if sections.memes?.items.length}
			<section>
				{#if !typed}<h2>Memes</h2>{/if}
				<div class="memes">
					{#each sections.memes.items as item (item.id)}
						<MemeCard {item} feedIds={memeIds} />
					{/each}
				</div>
				{@render pager('memes', sections.memes.total)}
			</section>
		{/if}

		{#if sections.tags?.length}
			<section>
				{#if !typed}<h2>Tags</h2>{/if}
				<ul class="tags">
					{#each sections.tags as tag (tag.name)}
						<li>
							<a href="{resolve('/')}?tag={encodeURIComponent(tag.name)}" class="tag">
								#{tag.name} <span class="count">{tag.count}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if sections.people?.items.length}
			<section>
				{#if !typed}<h2>People</h2>{/if}
				<ul class="rows">
					{#each sections.people.items as person (person.id)}
						<li>
							<a href={resolve('/users/[pid]', { pid: person.id })} class="row person">
								<Avatar thumbKey={person.avatarThumbKey} name={person.name} size={32} />
								<span class="name">{person.name}</span>
								<RoleBadge role={person.role} />
							</a>
						</li>
					{/each}
				</ul>
				{@render pager('people', sections.people.total)}
			</section>
		{/if}

		{#if sections.comments?.items.length}
			<section>
				{#if !typed}<h2>Comments</h2>{/if}
				<ul class="rows">
					{#each sections.comments.items as comment (comment.id)}
						{@const hit = highlight(comment.excerpt, data.text)}
						<li class="row comment">
							<span class="author">
								<Avatar thumbKey={comment.authorAvatar} name={comment.author} size={24} />
								<a href={resolve('/users/[pid]', { pid: comment.authorId })} class="name"
									>{comment.author}</a
								>
								<RoleBadge role={comment.authorRole} />
							</span>
							<a href={resolve('/meme/[pid]', { pid: comment.mediaId })} class="body">
								<span class="excerpt"
									>{#if hit}{hit.before}<mark>{hit.match}</mark
										>{hit.after}{:else}{comment.excerpt}{/if}</span
								>
								<span class="meta">
									<span class="meme-title">{comment.mediaTitle}</span>
									<time datetime={comment.createdAt}>{formatDateTime(comment.createdAt)}</time>
								</span>
							</a>
						</li>
					{/each}
				</ul>
				{@render pager('comments', sections.comments.total)}
			</section>
		{/if}

		{#if sections.quotes?.items.length}
			<section>
				{#if !typed}<h2>Quotes</h2>{/if}
				<ul class="rows">
					{#each sections.quotes.items as quote (quote.id)}
						<li>
							<a href={resolve('/quotes')} class="row quote">
								<span class="excerpt">{quote.text}</span>
								<span class="meta">— {quote.author}</span>
							</a>
						</li>
					{/each}
				</ul>
				{@render pager('quotes', sections.quotes.total)}
			</section>
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
		max-width: 560px;
		margin: 0 auto;
		padding: 6px var(--gutter);
		background: var(--bg);
	}

	h1 {
		margin: 0;
		font-size: 18px;
	}

	h2 {
		margin: 0 0 8px;
		font-size: 14px;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.4px;
	}

	main {
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 560px;
		margin: 0 auto;
		padding: 4px var(--gutter) calc(var(--tabbar-height) + 32px + env(safe-area-inset-bottom));
	}

	.form {
		display: flex;
		gap: 8px;
		margin: 0;
	}

	.form input {
		flex: 1;
		min-width: 0;
		min-height: 44px;
		padding: 0 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}

	.submit {
		display: grid;
		flex: none;
		place-items: center;
		width: 44px;
		height: 44px;
		padding: 0;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: var(--accent-text);
		cursor: pointer;
	}

	.chips {
		display: flex;
		gap: 2px;
		/* the vertical padding leaves room for the focus ring, which overflow-x: auto would clip */
		padding-block: 4px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.chips a {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 7px;
		border-radius: var(--radius-pill);
		color: var(--text-muted);
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
	}

	.chips a[aria-current='page'] {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	section {
		min-width: 0;
	}

	.memes {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.tags,
	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 36px;
		padding: 0 14px;
		border-radius: var(--radius-pill);
		background: var(--accent-soft);
		color: var(--accent-soft-text);
		font-size: 14px;
	}

	.count {
		font-size: 12px;
		opacity: 0.8;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.row {
		display: flex;
		gap: 8px;
		min-height: 44px;
		padding: 12px;
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font-size: 14px;
		overflow-wrap: anywhere;
	}

	.person {
		align-items: center;
		gap: 10px;
	}

	.comment,
	.quote {
		flex-direction: column;
	}

	.comment {
		gap: 8px;
	}

	.author {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}

	.author .name {
		color: inherit;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		color: inherit;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 8px;
		color: var(--text-muted);
		font-size: 12px;
	}

	.meme-title {
		font-style: italic;
	}

	mark {
		border-radius: 3px;
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.empty {
		margin: 24px 0;
		color: var(--text-muted);
		text-align: center;
	}

	.pager {
		display: flex;
		justify-content: center;
		margin-top: 8px;
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
