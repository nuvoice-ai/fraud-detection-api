<script>
	let { active } = $props();
</script>

<nav>
	<a href="/" class:active={active === 'analyze'}>Analyze</a>
	<a href="/record" class:active={active === 'record'}>Record</a>
</nav>

<style>
	nav {
		display: flex;
		gap: 4px;
		margin-top: 12px;
	}

	a {
		color: rgba(255, 255, 255, 0.75);
		text-decoration: none;
		font-size: 0.9rem;
		padding: 4px 12px;
		border-radius: 4px;
		transition: background 0.15s;
	}

	a:hover {
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
	}

	a.active {
		background: rgba(255, 255, 255, 0.2);
		color: #fff;
		font-weight: 500;
	}
</style>
