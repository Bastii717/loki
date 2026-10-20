<script lang="ts">
	let { data } = $props();
</script>

<h1>Loki</h1>
<p>Angemeldet als {data.user.username} ({data.user.role})</p>
<form method="POST" action="/logout">
	<button type="submit">Abmelden</button>
</form>
