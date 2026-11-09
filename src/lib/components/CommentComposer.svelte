<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { apiErrorMessage } from '../api-error';
	import { encodeMentions, MAX_COMMENT_LENGTH, MAX_MENTIONS, mentionQuery } from '../mentions';
	import type { CommentItem } from '../server/comments';
	import Avatar from './Avatar.svelte';

	type Picked = { id: string; name: string };
	type Person = Picked & { avatarThumbKey: string | null };

	/**
	 * Comment form with the @mention picker. The textarea shows `@<name>`; picked members are kept
	 * on the side and turned back into tokens on submit (`encodeMentions`), so a name edited by hand
	 * stays plain text. Posts itself and hands the created comment to `onposted`; with `editId` it
	 * saves an edit of that comment instead and hands over the updated one.
	 */
	let {
		mediaId,
		replyTo = null,
		editId = null,
		initialText = '',
		initialPicks = [],
		label,
		placeholder = 'Write a comment…',
		locked,
		lockTitle = undefined,
		blocked,
		autofocus = false,
		onposted,
		oncancel
	}: {
		/** Public id of the meme. */
		mediaId: string;
		/** Public id of the answered comment; null for a top-level comment. */
		replyTo?: string | null;
		/** Public id of the own comment being edited; null when writing a new one. */
		editId?: string | null;
		initialText?: string;
		initialPicks?: Picked[];
		/** Accessible name of the textarea. */
		label: string;
		placeholder?: string;
		locked: boolean;
		lockTitle?: string;
		/** Explains the write lock via `show` and returns true while writes are locked. */
		blocked: (show: (message: string) => void) => boolean;
		autofocus?: boolean;
		onposted: (item: CommentItem) => void;
		/** Shows a Cancel button (inline reply composer, editor). */
		oncancel?: () => void;
	} = $props();

	const FALLBACK = 'Could not send the comment.';
	const DEBOUNCE_MS = 150;

	const uid = $props.id();
	const listId = `${uid}-people`;
	const optionId = (i: number) => `${uid}-person-${i}`;

	// Initial props seed the form; a parent that wants a fresh form remounts it.
	// svelte-ignore state_referenced_locally
	let text = $state(initialText);
	// svelte-ignore state_referenced_locally
	let picks = $state<Picked[]>([...initialPicks]);
	let sending = $state(false);
	let error = $state('');
	let textarea = $state<HTMLTextAreaElement>();

	// ---- mention picker
	let people = $state<Person[]>([]);
	let active = $state(-1);
	const open = $derived(people.length > 0);
	/** Index of the `@` being completed, while a query is pending or shown. */
	let queryStart: number | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	// bumped on every new query and on close, so late answers are dropped
	let seq = 0;

	/** Distinct picked members whose `@name` is still in the text. */
	function pickedCount(): number {
		const value = textarea?.value ?? text;
		return new Set(picks.filter((p) => value.includes(`@${p.name}`)).map((p) => p.id)).size;
	}

	function close() {
		clearTimeout(timer);
		seq += 1;
		queryStart = null;
		people = [];
		active = -1;
	}

	/** The `@query` right before the caret, or null. */
	function currentQuery(): { start: number; q: string } | null {
		if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return null;
		const caret = textarea.selectionStart;
		// the element's value, not `text`: this runs from the same input event that updates the binding
		return mentionQuery(textarea.value.slice(0, caret));
	}

	function oninput() {
		const query = currentQuery();
		// the server rejects more than five members; stop offering once five are picked
		if (!query || pickedCount() >= MAX_MENTIONS) return close();
		clearTimeout(timer);
		// While the query only grows at the same `@` (a second word too: "Lena K.") the shown list
		// stays until the new answer replaces it (the server matches more loosely than any client-side
		// filter could), so Enter keeps picking instead of adding a newline. A different `@` drops it:
		// a fast Enter must not insert a name found for the previous query.
		if (query.start !== queryStart) {
			people = [];
			active = -1;
		}
		queryStart = query.start;
		const mine = ++seq;
		timer = setTimeout(() => void search(query.q, mine), DEBOUNCE_MS);
	}

	async function search(q: string, mine: number) {
		try {
			const res = await fetch(`/api/mentions?q=${encodeURIComponent(q)}`);
			if (!res.ok || mine !== seq) return;
			const found = ((await res.json()) as { people: Person[] }).people;
			if (mine !== seq) return;
			people = found;
			active = found.length > 0 ? 0 : -1;
		} catch {
			// the picker just stays closed
		}
	}

	/** Closes the picker when the caret left the `@query` (click, arrow keys). */
	function recheck() {
		if (queryStart !== null && currentQuery()?.start !== queryStart) close();
	}

	async function pick(person: Person) {
		const query = currentQuery();
		if (!textarea || !query || query.start !== queryStart) return close();
		const caret = textarea.selectionStart;
		const insert = `@${person.name} `;
		const after = text.slice(caret);
		text = text.slice(0, query.start) + insert + (after.startsWith(' ') ? after.slice(1) : after);
		if (!picks.some((p) => p.id === person.id && p.name === person.name)) {
			picks.push({ id: person.id, name: person.name });
		}
		close();
		const at = query.start + insert.length;
		await tick();
		textarea.focus();
		textarea.setSelectionRange(at, at);
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open || e.isComposing) return;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const step = e.key === 'ArrowDown' ? 1 : -1;
			active = (active + step + people.length) % people.length;
		} else if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && active >= 0) {
			e.preventDefault();
			void pick(people[active]);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	}

	// keep the active option visible in the scrolling list
	$effect(() => {
		if (active >= 0)
			document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
	});

	onMount(() => {
		if (autofocus && textarea) {
			textarea.focus();
			textarea.setSelectionRange(text.length, text.length);
		}
		return () => clearTimeout(timer);
	});

	// ---- submit
	async function failure(res: Response): Promise<string> {
		// 400 carries the user-facing reason (length, too many mentions)
		if (res.status === 400) {
			try {
				const body = (await res.json()) as { message?: unknown };
				if (typeof body.message === 'string' && body.message !== '') return body.message;
			} catch {
				// fall through
			}
			return FALLBACK;
		}
		if (res.status === 404 && editId !== null) return 'The comment is gone.';
		if (res.status === 404 && replyTo !== null) return 'The comment you are replying to is gone.';
		return apiErrorMessage(res, FALLBACK);
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const value = text.trim();
		if (!value || sending || blocked((m) => (error = m))) return;
		const encoded = encodeMentions(value, picks);
		// the server counts the encoded text, where each mention is a longer token than the name
		if (encoded.length > MAX_COMMENT_LENGTH) {
			error = `Too long: a mention is stored as a longer reference, so this comment is ${encoded.length} of ${MAX_COMMENT_LENGTH} characters. Please shorten it.`;
			return;
		}
		close();
		sending = true;
		error = '';
		try {
			const res =
				editId !== null
					? await fetch(`/api/comments/${editId}`, {
							method: 'PATCH',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({ text: encoded })
						})
					: await fetch(`/api/memes/${mediaId}/comments`, {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify({
								text: encoded,
								...(replyTo !== null ? { replyTo } : {})
							})
						});
			if (!res.ok) {
				error = await failure(res);
				return;
			}
			const item = (await res.json()) as CommentItem;
			text = '';
			picks = [];
			onposted(item);
		} catch {
			error = FALLBACK;
		} finally {
			sending = false;
		}
	}
</script>

<form onsubmit={submit}>
	<div class="field">
		<textarea
			bind:this={textarea}
			bind:value={text}
			{placeholder}
			aria-label={label}
			role="combobox"
			aria-autocomplete="list"
			aria-expanded={open}
			aria-controls={listId}
			aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
			maxlength={MAX_COMMENT_LENGTH}
			rows="2"
			{oninput}
			{onkeydown}
			onclick={recheck}
			onkeyup={(e) => {
				if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) recheck();
			}}
			onblur={close}></textarea>
		<ul id={listId} role="listbox" aria-label="Members" class="picker" hidden={!open}>
			{#each people as person, i (person.id)}
				<!-- options are chosen from the textarea (aria-activedescendant); clicks are the pointer path -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id={optionId(i)}
					role="option"
					aria-selected={i === active}
					class:active={i === active}
					onmousedown={(e) => e.preventDefault()}
					onmouseenter={() => (active = i)}
					onclick={() => pick(person)}
				>
					<Avatar thumbKey={person.avatarThumbKey} name={person.name} size={24} />
					<span class="person">{person.name}</span>
				</li>
			{/each}
		</ul>
		<p class="sr-only" role="status">
			{open ? `${people.length} ${people.length === 1 ? 'member' : 'members'} found` : ''}
		</p>
	</div>
	<div class="buttons">
		{#if oncancel}
			<button type="button" class="cancel" onclick={oncancel}>Cancel</button>
		{/if}
		<button
			type="submit"
			class="send"
			disabled={sending || text.trim() === '' || (editId !== null && text === initialText)}
			aria-disabled={locked ? 'true' : undefined}
			title={lockTitle}>{editId !== null ? 'Save' : 'Send'}</button
		>
	</div>
</form>
{#if error}
	<p class="error" role="alert">{error}</p>
{/if}

<style>
	form {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: flex-end;
	}

	.field {
		position: relative;
		flex: 1 1 200px;
		min-width: 0;
		display: flex;
	}

	textarea {
		flex: 1;
		min-width: 0;
		resize: none;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font: inherit;
	}

	/* above the field, so a phone keyboard below it does not cover the list */
	.picker {
		position: absolute;
		bottom: calc(100% + 4px);
		left: 0;
		right: 0;
		z-index: 4;
		max-height: min(320px, 40vh);
		overflow-y: auto;
		margin: 0;
		padding: 4px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-raised);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		list-style: none;
	}

	.picker[hidden] {
		display: none;
	}

	.picker li {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 0 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	.picker li.active {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.person {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.buttons {
		display: flex;
		gap: 8px;
		margin-left: auto;
	}

	.buttons button {
		padding: 10px 14px;
		border: 0;
		border-radius: var(--radius-pill);
		font-weight: 600;
		cursor: pointer;
	}

	.send {
		background: var(--accent);
		color: var(--accent-text);
	}

	.cancel {
		background: none;
		color: var(--text-muted);
	}

	.send:disabled {
		opacity: 0.5;
		cursor: default;
	}

	[aria-disabled='true'] {
		opacity: 0.5;
	}

	.error {
		margin: 6px 0 0;
		color: var(--down);
		font-size: 13px;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
</style>
