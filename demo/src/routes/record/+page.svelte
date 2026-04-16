<script>
	import { onMount, onDestroy } from 'svelte';
	import Button, { Label } from '@smui/button';
	import Card, { Content } from '@smui/card';
	import Nav from '$lib/Nav.svelte';

	/** @type {'idle' | 'recording' | 'stopped'} */
	let status = $state('idle');
	let duration = $state(0);
	let recordedBlob = $state(null);
	let micError = $state(null);
	let isPlaying = $state(false);

	let wavesurfer = null;
	let mediaRecorder = null;
	let stream = null;
	let chunks = [];
	let timer = null;
	let waveformEl;

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
		cleanup();
		wavesurfer?.destroy();
	});

	function cleanup() {
		if (mediaRecorder?.state !== 'inactive') mediaRecorder?.stop();
		stream?.getTracks().forEach((t) => t.stop());
		clearInterval(timer);
	}

	async function startRecording() {
		micError = null;
		recordedBlob = null;
		chunks = [];
		wavesurfer?.empty();

		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
		} catch (e) {
			micError =
				e.name === 'NotAllowedError'
					? 'Microphone access was denied. Please allow microphone access and try again.'
					: `Could not access microphone: ${e.message}`;
			return;
		}

		mediaRecorder = new MediaRecorder(stream);
		mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunks.push(e.data);
		};
		mediaRecorder.onstop = async () => {
			const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
			recordedBlob = blob;
			const url = URL.createObjectURL(blob);
			await wavesurfer.load(url);
		};

		mediaRecorder.start();
		status = 'recording';
		duration = 0;
		timer = setInterval(() => duration++, 1000);
	}

	function stopRecording() {
		clearInterval(timer);
		if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
		stream?.getTracks().forEach((t) => t.stop());
		status = 'stopped';
	}

	function togglePlay() {
		wavesurfer?.playPause();
	}

	async function saveRecording() {
		if (!recordedBlob) return;

		const arrayBuffer = await recordedBlob.arrayBuffer();
		const audioCtx = new AudioContext();
		let audioBuffer;
		try {
			audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
		} finally {
			audioCtx.close();
		}

		const wavBlob = encodeWav(audioBuffer);
		const url = URL.createObjectURL(wavBlob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `recording-${Date.now()}.wav`;
		a.click();
		URL.revokeObjectURL(url);
	}

	/**
	 * Encode an AudioBuffer as a 16-bit mono PCM WAV Blob.
	 * @param {AudioBuffer} audioBuffer
	 * @returns {Blob}
	 */
	function encodeWav(audioBuffer) {
		const input = audioBuffer.getChannelData(0);
		if (audioBuffer.numberOfChannels > 1) {
			const right = audioBuffer.getChannelData(1);
			for (let i = 0; i < input.length; i++) {
				input[i] = (input[i] + right[i]) / 2;
			}
		}

		const sampleRate = audioBuffer.sampleRate;
		const numSamples = input.length;
		const dataBytes = numSamples * 2;
		const wavBuffer = new ArrayBuffer(44 + dataBytes);
		const v = new DataView(wavBuffer);

		function str(offset, s) {
			for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
		}

		str(0, 'RIFF');
		v.setUint32(4, 36 + dataBytes, true);
		str(8, 'WAVE');
		str(12, 'fmt ');
		v.setUint32(16, 16, true);
		v.setUint16(20, 1, true);
		v.setUint16(22, 1, true);
		v.setUint32(24, sampleRate, true);
		v.setUint32(28, sampleRate * 2, true);
		v.setUint16(32, 2, true);
		v.setUint16(34, 16, true);
		str(36, 'data');
		v.setUint32(40, dataBytes, true);

		let offset = 44;
		for (let i = 0; i < numSamples; i++) {
			const s = Math.max(-1, Math.min(1, input[i]));
			v.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
			offset += 2;
		}

		return new Blob([wavBuffer], { type: 'audio/wav' });
	}

	function formatDuration(secs) {
		const m = String(Math.floor(secs / 60)).padStart(2, '0');
		const s = String(secs % 60).padStart(2, '0');
		return `${m}:${s}`;
	}
</script>

<div class="app">
	<header>
		<h1>Voice Fraud Detection API</h1>
		<p>Audio Deepfake Detection</p>
		<Nav active="record" />
	</header>

	<main>
		<!-- Recorder -->
		<Card>
			<Content>
				<h2>Record Audio</h2>

				<div class="status-row">
					{#if status === 'idle'}
						<span class="status-dot idle"></span>
						<span class="status-text">Ready</span>
					{:else if status === 'recording'}
						<span class="status-dot recording"></span>
						<span class="status-text recording">Recording&nbsp;&nbsp;{formatDuration(duration)}</span>
					{:else}
						<span class="status-dot stopped"></span>
						<span class="status-text">Stopped&nbsp;&nbsp;{formatDuration(duration)}</span>
					{/if}
				</div>

				{#if micError}
					<div class="mic-error">{micError}</div>
				{/if}

				<div class="controls">
					{#if status !== 'recording'}
						<Button variant="raised" onclick={startRecording}>
							<Label>{status === 'stopped' ? 'Record Again' : 'Record'}</Label>
						</Button>
					{/if}
					{#if status === 'recording'}
						<Button variant="raised" onclick={stopRecording} class="stop-btn">
							<Label>Stop</Label>
						</Button>
					{/if}
				</div>
			</Content>
		</Card>

		<!-- Preview — waveform div always in DOM so WaveSurfer can attach on mount -->
		<Card>
			<Content>
				<h2>Preview</h2>
				<div class="waveform-wrap">
					<div bind:this={waveformEl} class="waveform"></div>
					{#if status === 'idle' || status === 'recording'}
						<div class="waveform-placeholder">
							{status === 'recording' ? 'Recording in progress…' : 'Recording will appear here after you stop'}
						</div>
					{/if}
				</div>
				<div class="controls">
					<Button variant="outlined" onclick={togglePlay} disabled={status !== 'stopped'}>
						<Label>{isPlaying ? 'Pause' : 'Play'}</Label>
					</Button>
					<Button variant="raised" onclick={saveRecording} disabled={status !== 'stopped' || !recordedBlob}>
						<Label>Save as WAV</Label>
					</Button>
				</div>
			</Content>
		</Card>
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: Roboto, sans-serif;
		background: #f5f5f5;
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

	/* Status */
	.status-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 24px;
		min-height: 28px;
	}

	.status-dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.status-dot.idle     { background: #bdbdbd; }
	.status-dot.stopped  { background: #43a047; }
	.status-dot.recording {
		background: #e53935;
		animation: pulse 1s ease-in-out infinite;
	}

	.status-text {
		font-size: 1rem;
		color: #424242;
		font-variant-numeric: tabular-nums;
	}

	.status-text.recording {
		color: #e53935;
		font-weight: 500;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50%       { opacity: 0.5; transform: scale(0.85); }
	}

	/* Error */
	.mic-error {
		background: #ffebee;
		color: #b71c1c;
		padding: 12px 16px;
		border-radius: 6px;
		font-size: 0.9rem;
		margin-bottom: 20px;
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

	/* Controls */
	.controls {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}

	.controls :global(.stop-btn) {
		--mdc-theme-primary: #e53935;
	}
</style>
