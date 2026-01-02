# NuVoice Fraud Detection API Reference

Version: 1.0.0

## Overview

The NuVoice Fraud Detection API provides real-time fraud/deepfake detection over audio for **single-shot voice verification** use cases. Submit a short audio sample (e.g., spoken challenge phrase) and receive an immediate prediction on whether the voice is genuine or synthetic/fraudulent. This way you can protect your voice verification systems that login and authenticate a user against fraud by AI generated voices.

**Ideal for:**
- Voice authentication gates ("Please say 'My voice is my password'")
- Login/enrollment verification before granting access
- Quick fraud checks on short utterances (3-30 seconds)
- One-time voice verification in authentication flows

**For continuous call monitoring**, see the [Streaming API](streaming-api.md) which monitors entire conversations via WebSocket.

## Base URL

```
https://fraud-api.nuvoice.ai
```

## Authentication

The API uses Bearer token authentication. Include your API key in the Authorization header:

```
Authorization: Bearer YOUR_API_KEY
```

**No API Key is needed for requests from AWS using PrivateLink**.

## Endpoints

### POST /v1/fraud/detect

Detect whether an audio sample is real vs fake.

**Request Body**

Content-Type: `application/json`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `session_id` | string | No | Optional client-generated correlation id (e.g., Twilio CallSid). Min: 1, Max: 200 characters. |
| `audio` | [AudioInput](#audioinput) | Yes | Audio data to analyze. |
| `options` | [DetectRequestOptions](#detectrequestoptions) | No | Additional detection options. |

**Response**

Status: `200 OK`

Content-Type: `application/json`

Returns a [DetectResponse](#detectresponse) object containing the prediction result.

**Error Responses**

| Status Code | Description |
|-------------|-------------|
| 400 | Invalid request (bad JSON, missing fields, invalid audio params) |
| 401 | Missing/invalid authentication |
| 413 | Payload too large |
| 415 | Unsupported media type |
| 429 | Rate limited |
| 500 | Server error |

All error responses return an [ErrorResponse](#errorresponse) object.

## Data Models

### AudioInput

Audio data to be analyzed for fraud detection.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Base64-encoded audio bytes. Min length: 1 |
| `encoding` | string | Yes | Audio encoding. Must be one of: `mulaw`, `alaw`, `pcm_s16le`, `wav`, `mp3`, `opus` |
| `sample_rate_hz` | integer | Conditional | Sampling rate in Hz. Required for raw formats like `mulaw` or `pcm_s16le`. Range: 8000-48000 |
| `channels` | integer | No | Number of channels. 1=mono, 2=stereo. Range: 1-2 |

**Example**

```json
{
  "content": "BASE64_AUDIO_HERE",
  "encoding": "mulaw",
  "sample_rate_hz": 8000,
  "channels": 1
}
```

### DetectRequestOptions

Optional configuration for the detection request.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `return_scores` | boolean | No | If true, return per-class probability scores in addition to prediction/confidence. Default: false |
| `threshold` | number | No | Optional override threshold for labeling fake vs real (model still returns raw scores). Range: 0-1 |
| `calibration_profile` | string | No | Optional calibration profile name (e.g., "default", "bank_v1") |

### DetectResponse

The result of a fraud detection request.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prediction` | string | Yes | Detection result. Either `real` or `fake` |
| `confidence` | number | Yes | Confidence of the returned prediction (calibrated as best-effort). Range: 0-1 |
| `request_id` | string | Yes | Server-generated id for debugging/support |
| `processing_ms` | integer | No | Server-side processing time in milliseconds. Min: 0 |
| `scores` | [DetectResponseScores](#detectresponsescores) | No | Optional per-class scores/probabilities (included if `return_scores` was true) |

**Example**

```json
{
  "prediction": "real",
  "confidence": 0.93,
  "request_id": "req_01HX9K...",
  "processing_ms": 184,
  "scores": {
    "fake": 0.07,
    "real": 0.93
  }
}
```

### DetectResponseScores

Per-class probability scores.

| Field | Type | Description |
|-------|------|-------------|
| `real` | number | Probability that audio is real. Range: 0-1 |
| `fake` | number | Probability that audio is fake. Range: 0-1 |

### ErrorResponse

Standard error response format.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `error` | object | Yes | Error details object |
| `error.code` | string | Yes | Stable machine-readable error code |
| `error.message` | string | Yes | Human-readable error message |
| `error.request_id` | string | No | Present when available for debugging/support |
| `error.details` | object | No | Optional structured error details |

**Example**

```json
{
  "error": {
    "code": "invalid_audio_encoding",
    "message": "Unsupported audio encoding format",
    "request_id": "req_01HX9K..."
  }
}
```

## Usage Examples

### Basic Detection (WAV file)

```bash
curl -X POST https://fraud-api.nuvoice.ai/v1/fraud/detect \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "demo_123",
    "audio": {
      "content": "UklGRiQAAABXQVZFZm10...",
      "encoding": "wav"
    }
  }'
```

### Twilio-style mu-law @ 8kHz with Scores

```bash
curl -X POST https://fraud-api.nuvoice.ai/v1/fraud/detect \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "call_123",
    "audio": {
      "content": "BASE64_AUDIO_HERE",
      "encoding": "mulaw",
      "sample_rate_hz": 8000,
      "channels": 1
    },
    "options": {
      "return_scores": true
    }
  }'
```

### Using the TypeScript Client

```typescript
import fs from 'node:fs';
import { DefaultApi, AudioInput } from './node-client';

const client = new DefaultApi('https://fraud-api.nuvoice.ai');
client.accessToken = process.env.NUVOICE_API_KEY || '';

const audioBytes = fs.readFileSync('audio.wav');
const request = {
  sessionId: `demo_${Date.now()}`,
  audio: {
    content: audioBytes.toString('base64'),
    encoding: AudioInput.EncodingEnum.Wav,
  },
  options: {
    returnScores: true,
  },
};

const { body } = await client.detectFraud(request);
console.log(body);
```

## Supported Audio Formats

| Format | Encoding Value | Notes |
|--------|----------------|-------|
| mu-law | `mulaw` | Requires `sample_rate_hz` (typically 8000) |
| A-law | `alaw` | Requires `sample_rate_hz` |
| PCM signed 16-bit little-endian | `pcm_s16le` | Requires `sample_rate_hz` |
| WAV | `wav` | Self-contained format |
| MP3 | `mp3` | Self-contained format |
| Opus | `opus` | Self-contained format |

## Rate Limits

Rate limits are enforced per API key. When exceeded, the API returns a `429 Too Many Requests` status code.

## Best Practices

1. **Session IDs**: Use meaningful session IDs (e.g., call IDs from your telephony system) to correlate requests with your internal systems.

2. **Audio Quality**: For best results, provide audio with:
   - At least 8kHz sampling rate
   - Mono audio (single channel)
   - Sufficient duration (typically 3+ seconds)

3. **Error Handling**: Always check the response status code and handle errors appropriately. Use the `request_id` from error responses when contacting support.

4. **Return Scores**: Enable `return_scores: true` if you need raw probability scores for custom thresholding or analysis.

5. **Base64 Encoding**: Ensure audio is properly base64-encoded before sending. Most programming languages have built-in base64 encoding functions.

## Support

For issues or questions, contact support with the `request_id` from your API response for faster troubleshooting.
