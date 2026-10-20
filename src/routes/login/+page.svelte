<script lang="ts">
	import { NO_ACCESS_MESSAGE } from '../../lib/auth-messages';

	let { data } = $props();

	const messages: Record<string, string> = {
		no_access: NO_ACCESS_MESSAGE,
		failed: 'Anmeldung fehlgeschlagen. Bitte versuche es erneut.'
	};
	const message = $derived(data.error ? (messages[data.error] ?? messages.failed) : null);
</script>

<main>
	<h1>Loki</h1>
	{#if message}
		<p role="alert">{message}</p>
	{/if}
	<form method="POST">
		<button type="submit">Mit Authentik anmelden</button>
	</form>
</main>
