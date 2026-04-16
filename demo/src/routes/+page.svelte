<script>
	import { onMount, onDestroy } from 'svelte';
	import { PUBLIC_API_URL, PUBLIC_API_TOKEN } from '$env/static/public';
	import Button, { Label } from '@smui/button';
	import Card, { Content } from '@smui/card';
	import CircularProgress from '@smui/circular-progress';
	import Nav from '$lib/Nav.svelte';

	const configError =
		!PUBLIC_API_URL || !PUBLIC_API_TOKEN
			? `Missing .env variable(s): ${[!PUBLIC_API_URL && 'PUBLIC_API_URL', !PUBLIC_API_TOKEN && 'PUBLIC_API_TOKEN'].filter(Boolean).join(', ')}`
			: null;

	let wavesurfer = $state(null);
	let loadedFile = $state(null);
	let isPlaying = $state(false);
	let isLoadingAudio = $state(false);
	let analyzing = $state(false);
	let result = $state(null);
	let apiError = $state(null);
	let showRaw = $state(false);

	let waveformEl;
	let fileInputEl;
	let objectUrl = null;

	let hasAudio = $derived(loadedFile !== null);
	let canAnalyze = $derived(hasAudio && !analyzing && !isLoadingAudio && !configError);

	onMount(async () => {
		const WaveSurfer = (await import('wavesurfer.js')).default;
		wavesurfer = WaveSurfer.create({
			container: waveformEl,
			waveColor: '#90caf9',
			progressColor: '#1565c0',
			cursorColor: '#1565c0',
			height: 80,
			normalize: true
		});
		wavesurfer.on('play', () => (isPlaying = true));
		wavesurfer.on('pause', () => (isPlaying = false));
		wavesurfer.on('finish', () => (isPlaying = false));
	});

	onDestroy(() => {
		wavesurfer?.destroy();
		revokeObjectUrl();
	});

	function revokeObjectUrl() {
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
	}

	async function onFileSelected(e) {
		const file = e.target.files[0];
		if (!file) return;

		revokeObjectUrl();
		result = null;
		apiError = null;
		showRaw = false;
		isLoadingAudio = true;
		loadedFile = file;

		objectUrl = URL.createObjectURL(file);
		try {
			await wavesurfer.load(objectUrl);
		} finally {
			isLoadingAudio = false;
		}
		e.target.value = '';
	}

	function togglePlay() {
		wavesurfer?.playPause();
	}

	function arrayBufferToBase64(buffer) {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		const chunk = 0x8000;
		for (let i = 0; i < bytes.length; i += chunk) {
			binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
		}
		return btoa(binary);
	}

	function detectEncoding(filename) {
		const ext = filename.split('.').pop()?.toLowerCase();
		return ['wav', 'mp3', 'opus'].includes(ext) ? ext : 'wav';
	}

	async function analyze() {
		if (!loadedFile) return;
		analyzing = true;
		result = null;
		apiError = null;

		try {
			const buffer = await loadedFile.arrayBuffer();
			const base64 = arrayBufferToBase64(buffer);

			const res = await fetch(`${PUBLIC_API_URL}/v1/fraud/detect`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${PUBLIC_API_TOKEN}`
				},
				body: JSON.stringify({
					audio: {
						content: base64,
						encoding: detectEncoding(loadedFile.name)
					},
					options: { return_scores: true }
				})
			});

			const data = await res.json();
			if (res.ok) {
				result = data;
			} else {
				apiError = data;
			}
		} catch (e) {
			apiError = { error: { code: 'network_error', message: e.message } };
		} finally {
			analyzing = false;
		}
	}
</script>

<div class="app">
	{#if configError}
		<div class="config-error">{configError}</div>
	{/if}

	<header>
		<h1>Voice Fraud Detection API</h1>
		<p>Audio Deepfake Detection</p>
		<Nav active="analyze" />
	</header>

	<main>
		<!-- Audio input -->
		<Card>
			<Content>
				<h2>Audio Input</h2>
				<div class="input-row">
					<input
						bind:this={fileInputEl}
						type="file"
						accept=".wav,.mp3,.opus"
						onchange={onFileSelected}
						hidden
					/>
					<Button variant="raised" onclick={() => fileInputEl.click()}>
						<Label>Browse File</Label>
					</Button>
					{#if loadedFile}
						<span class="filename">{loadedFile.name}</span>
					{:else}
						<span class="filename muted">No file selected</span>
					{/if}
				</div>
			</Content>
		</Card>

		<!-- Waveform & controls — always rendered so WaveSurfer has a DOM node on mount -->
		<Card>
			<Content>
				<h2>Preview</h2>
				<div class="waveform-wrap">
					<div bind:this={waveformEl} class="waveform"></div>
					{#if !hasAudio}
						<div class="waveform-placeholder">Select an audio file to preview</div>
					{/if}
					{#if isLoadingAudio}
						<div class="waveform-loading">
							<CircularProgress indeterminate style="height:28px;width:28px" />
						</div>
					{/if}
				</div>
				<div class="controls">
					<Button variant="outlined" onclick={togglePlay} disabled={!hasAudio}>
						<Label>{isPlaying ? 'Pause' : 'Play'}</Label>
					</Button>
					<Button variant="raised" onclick={analyze} disabled={!canAnalyze}>
						{#if analyzing}
							<CircularProgress
								indeterminate
								style="height:18px;width:18px;margin-right:8px"
							/>
						{/if}
						<Label>{analyzing ? 'Analyzing…' : 'Analyze'}</Label>
					</Button>
				</div>
			</Content>
		</Card>

		<!-- Result -->
		{#if result || apiError}
			<Card>
				<Content>
					{#if result}
						<div class="result-badge {result.prediction}">
							{result.prediction.toUpperCase()}
						</div>
						<p class="confidence">
							Confidence: <strong>{Math.round(result.confidence * 100)}%</strong>
							{#if result.processing_ms}
								<span class="ms">&nbsp;·&nbsp;{result.processing_ms} ms</span>
							{/if}
						</p>
						{#if result.scores}
							<div class="scores">
								{#each [['real', result.scores.real], ['fake', result.scores.fake]] as [label, score]}
									<div class="score-row">
										<span class="score-label">{label}</span>
										<div class="bar-track">
											<div
												class="bar-fill {label}"
												style="width:{Math.round(score * 100)}%"
											></div>
										</div>
										<span class="score-value">{Math.round(score * 100)}%</span>
									</div>
								{/each}
							</div>
						{/if}
						<button class="link-btn" onclick={() => (showRaw = !showRaw)}>
							{showRaw ? 'Hide' : 'Show'} raw JSON
						</button>
						{#if showRaw}
							<pre class="json">{JSON.stringify(result, null, 2)}</pre>
						{/if}
					{/if}
					{#if apiError}
						<pre class="json error">{JSON.stringify(apiError, null, 2)}</pre>
					{/if}
				</Content>
			</Card>
		{/if}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: Roboto, sans-serif;
		background: #f5f5f5;
	}

	.config-error {
		background: #b71c1c;
		color: #fff;
		padding: 12px 24px;
		font-size: 0.9rem;
		font-family: monospace;
	}

	header {
		background: #1565c0;
		color: #fff;
		padding: 24px 32px;
	}

	header h1 {
		margin: 0 0 4px;
		font-size: 1.8rem;
		font-weight: 600;
	}

	header p {
		margin: 0;
		opacity: 0.8;
		font-size: 0.95rem;
	}

	main {
		max-width: 860px;
		margin: 0 auto;
		padding: 24px 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	h2 {
		margin: 0 0 16px;
		font-size: 0.8rem;
		font-weight: 500;
		color: #616161;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	/* Audio input */
	.input-row {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.filename {
		font-size: 0.9rem;
		color: #424242;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.filename.muted {
		color: #9e9e9e;
	}

	/* Waveform */
	.waveform-wrap {
		position: relative;
		background: #e3f2fd;
		border-radius: 6px;
		min-height: 96px;
		margin-bottom: 16px;
		overflow: hidden;
	}

	.waveform {
		padding: 8px;
	}

	.waveform-placeholder {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #90a4ae;
		font-size: 0.9rem;
		pointer-events: none;
	}

	.waveform-loading {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(227, 242, 253, 0.7);
	}

	.controls {
		display: flex;
		gap: 12px;
	}

	/* Result */
	.result-badge {
		font-size: 2.5rem;
		font-weight: 700;
		text-align: center;
		padding: 20px;
		border-radius: 8px;
		margin-bottom: 16px;
		letter-spacing: 0.08em;
	}

	.result-badge.real {
		background: #e8f5e9;
		color: #1b5e20;
	}

	.result-badge.fake {
		background: #ffebee;
		color: #b71c1c;
	}

	.confidence {
		margin: 0 0 16px;
		font-size: 1rem;
	}

	.ms {
		color: #9e9e9e;
		font-size: 0.85rem;
	}

	.scores {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 16px;
	}

	.score-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.score-label {
		width: 36px;
		font-size: 0.85rem;
		color: #616161;
		text-transform: capitalize;
	}

	.bar-track {
		flex: 1;
		height: 10px;
		background: #e0e0e0;
		border-radius: 5px;
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		border-radius: 5px;
		transition: width 0.4s ease;
	}

	.bar-fill.real {
		background: #43a047;
	}

	.bar-fill.fake {
		background: #e53935;
	}

	.score-value {
		width: 40px;
		text-align: right;
		font-size: 0.85rem;
		font-weight: 500;
	}

	.link-btn {
		background: none;
		border: none;
		color: #1565c0;
		cursor: pointer;
		font-size: 0.85rem;
		padding: 0;
		text-decoration: underline;
		margin-bottom: 8px;
		display: inline-block;
	}

	.json {
		background: #263238;
		color: #eceff1;
		padding: 16px;
		border-radius: 6px;
		overflow-x: auto;
		font-size: 0.8rem;
		margin: 0;
		line-height: 1.5;
	}

	.json.error {
		background: #ffebee;
		color: #b71c1c;
	}
</style>
