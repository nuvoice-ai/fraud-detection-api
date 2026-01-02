# Streaming API Reference

Version: 1.0.0

## Overview

The NuVoice Streaming API provides real-time fraud/deepfake detection over continuous audio streams using WebSocket connections. Unlike the REST API which analyzes a single short utterance for voice verification gates, the Streaming API monitors entire conversations.

**Ideal for:**
- Continuous call monitoring during phone conversations
- Live fraud detection throughout customer service calls
- Detecting mid-call voice switching (human → AI or vice versa)
- Real-time intervention capabilities (alert agents, terminate calls)
- Integration with telephony systems (Twilio, Vonage, etc.)

**Key Capability:** Receive incremental confidence scores as audio streams, enabling fraud detection and intervention while the call is still in progress, not just after it ends.

## WebSocket Endpoint

```
wss://fraud-api.nuvoice.ai/v1/fraud/stream
```

## Authentication

Authentication is handled via query parameters when establishing the WebSocket connection:

```
wss://fraud-api.nuvoice.ai/v1/fraud/stream?api_key=YOUR_API_KEY
```

**No API key is required for AWS PrivateLink connections**

```
wss://fraud-api.nuvoice.ai/v1/fraud/stream
```

## Connection Lifecycle

1. **Connect**: Client establishes WebSocket connection with authentication
2. **Start**: Client sends `start` message to begin session
3. **Stream**: Client sends `audio` messages with audio chunks
4. **Monitor**: Server sends `score` messages with incremental predictions
5. **Stop**: Client sends `stop` message to end session
6. **Finalize**: Server sends `final` message with final prediction
7. **Close**: WebSocket connection closes

**Connection Limits:**
- Maximum session duration: 20 minutes
- Idle timeout: 30 seconds (no messages received)
- Maximum concurrent sessions per API key: 100

## Message Flow

```
Client                          Server
  |                               |
  |--- WebSocket Connect -------->|
  |<-- Connection Established ----|
  |                               |
  |--- start ------------------->|
  |<-- started -------------------|
  |                               |
  |--- audio (seq: 1, 20ms) ---->|
  |--- audio (seq: 2, 20ms) ---->|  [Server buffers internally]
  |--- audio (seq: 3, 20ms) ---->|  [Accumulating audio...]
  |      ...                      |
  |--- audio (seq: 150, 20ms) -->|  [~3 seconds accumulated]
  |<-- score (seq: 150) ----------|  [First prediction ready]
  |--- audio (seq: 151, 20ms) -->|
  |--- audio (seq: 152, 20ms) -->|
  |<-- score (seq: 200) ----------|  [Interim update after 1 sec]
  |--- audio (seq: 201, 20ms) -->|
  |      ...                      |
  |--- stop -------------------->|
  |<-- final ---------------------|
  |<-- Connection Close ----------|
```

**Note**: The server buffers audio internally and will only send the first `score` message after accumulating sufficient audio (typically 3-5 seconds). Clients can send audio chunks of any size (including Twilio's 20ms chunks) without any client-side buffering.

## Server-Side Buffering

The API handles all buffering internally, so clients can send audio chunks of any size without concern:

**How It Works:**
1. **Client sends small chunks**: Send audio as it arrives (e.g., 20ms chunks from Twilio)
2. **Server buffers internally**: The server accumulates audio in memory
3. **Minimum audio requirement**: Server needs 3-5 seconds of audio before making first prediction
4. **First score sent**: Once sufficient audio is buffered, first `score` message is sent
5. **Subsequent scores**: Additional `score` messages sent based on `interim_interval` setting

**Key Benefits:**
- **No client buffering needed**: Forward audio chunks directly as received
- **Simplified integration**: No need to aggregate or batch chunks
- **Optimal latency**: Small chunks provide lowest latency
- **Flexible chunk sizes**: Any size from 20ms to 1000ms works

**Timeline Example (Twilio @ 8kHz mulaw):**
- `t=0s`: Session starts, client begins sending 20ms chunks
- `t=0-3s`: Server buffers 150 chunks (3 seconds of audio)
- `t=3s`: First `score` message sent (seq: 150)
- `t=4s`: Second `score` message sent (seq: 200) - if `interim_interval: 1000`
- `t=5s`: Third `score` message sent (seq: 250)
- Continue until `stop` message, then `final` message sent

**Minimum Audio Requirements:**
- **First prediction**: 3 seconds minimum
- **Reliable prediction**: 5+ seconds recommended
- **Final prediction**: Uses all accumulated audio for maximum accuracy

## Client Messages

### start

Initiates a new streaming session. Must be the first message sent after WebSocket connection.

**Message Format:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"start"` |
| `client_session_id` | string | No | Client-generated correlation ID (e.g., Twilio CallSid). Min: 1, Max: 200 characters |
| `encoding` | string | Yes | Audio encoding. One of: `mulaw`, `alaw`, `pcm_s16le`, `wav`, `mp3`, `opus` |
| `sample_rate_hz` | integer | Conditional | Sample rate in Hz. Required for raw formats (`mulaw`, `alaw`, `pcm_s16le`). Range: 8000-48000 |
| `channels` | integer | No | Number of audio channels. 1=mono, 2=stereo. Default: 1. Range: 1-2 |
| `options` | object | No | Additional options (see below) |

**Options Object:**

| Field | Type | Description |
|-------|------|-------------|
| `return_scores` | boolean | Return detailed per-class scores in addition to prediction. Default: false |
| `chunk_duration_ms` | integer | Expected duration of each audio chunk in milliseconds. Helps optimize processing. Default: auto-detect |
| `interim_interval` | integer | Minimum milliseconds between interim score updates. Default: 500. Range: 100-5000 |
| `language` | string | Expected language for better accuracy (e.g., "en-US", "es-ES"). Default: auto-detect |

**Example:**

```json
{
  "type": "start",
  "client_session_id": "call_CA1234567890",
  "encoding": "mulaw",
  "sample_rate_hz": 8000,
  "channels": 1,
  "options": {
    "return_scores": true,
    "interim_interval": 1000
  }
}
```

### audio

Sends an audio chunk for analysis. Can be sent continuously after receiving `started` message.

**Message Format:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"audio"` |
| `seq` | integer | Yes | Sequence number starting from 1. Must be monotonically increasing |
| `content` | string | Yes | Base64-encoded audio bytes |
| `timestamp_ms` | integer | No | Client timestamp in milliseconds (relative to session start or epoch). Used for synchronization |
| `is_final` | boolean | No | Indicates this is the last audio chunk before `stop`. Default: false |

**Audio Chunk Specifications:**
- **Any chunk size accepted**: Send chunks as small as 20ms or as large as 1000ms
- **Server buffers internally**: No client-side buffering required
- **Twilio-compatible**: Forward Twilio's 20ms chunks directly without modification
- **Maximum chunk size**: 10MB (base64-encoded)

**Common Chunk Sizes:**
- **Twilio Media Streams**: 20ms chunks (~160 bytes mulaw @ 8kHz)
- **Custom implementations**: 100ms-200ms chunks typical
- **Pre-recorded audio**: Can send larger chunks for faster-than-realtime processing

**Example (20ms Twilio chunk):**

```json
{
  "type": "audio",
  "seq": 17,
  "timestamp_ms": 340,
  "content": "HwBfAF8AXwBfAF8AXwBfAF8AXwBfAF8AXwBfAF8AXw..."
}
```

### stop

Signals end of audio stream and requests final prediction.

**Message Format:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"stop"` |
| `reason` | string | No | Optional reason for stopping (e.g., "call_ended", "user_hangup", "timeout") |

**Example:**

```json
{
  "type": "stop",
  "reason": "call_ended"
}
```

### ping

Optional keepalive message to prevent idle timeout.

**Message Format:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Must be `"ping"` |

**Example:**

```json
{
  "type": "ping"
}
```

## Server Messages

### started

Acknowledges session start and confirms accepted parameters.

**Message Format:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"started"` |
| `server_session_id` | string | Server-generated session ID for debugging/support |
| `client_session_id` | string | Echo of client's session ID (if provided) |
| `accepted` | object | Confirmed audio parameters |
| `accepted.encoding` | string | Confirmed encoding format |
| `accepted.sample_rate_hz` | integer | Confirmed sample rate |
| `accepted.channels` | integer | Confirmed channel count |

**Example:**

```json
{
  "type": "started",
  "server_session_id": "sess_01HX9KZQR2N8J5M3P7WXYZ",
  "client_session_id": "call_CA1234567890",
  "accepted": {
    "encoding": "mulaw",
    "sample_rate_hz": 8000,
    "channels": 1
  }
}
```

### score

Interim prediction score sent as audio is processed. Sent asynchronously as chunks are analyzed.

**Message Format:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"score"` |
| `seq` | integer | Sequence number corresponding to the audio message being scored |
| `prediction` | string | Current prediction: `"real"` or `"fake"` |
| `confidence` | number | Confidence in the current prediction. Range: 0-1 |
| `audio_duration_ms` | integer | Total milliseconds of audio analyzed so far |
| `processing_ms` | integer | Server processing time for this chunk in milliseconds |
| `scores` | object | Optional detailed scores (if `return_scores: true`) |
| `scores.real` | number | Probability that audio is real. Range: 0-1 |
| `scores.fake` | number | Probability that audio is fake. Range: 0-1 |

**Example:**

```json
{
  "type": "score",
  "seq": 17,
  "prediction": "real",
  "confidence": 0.52,
  "audio_duration_ms": 3400,
  "processing_ms": 22,
  "scores": {
    "real": 0.52,
    "fake": 0.48
  }
}
```

**Note:** Confidence and predictions may fluctuate as more audio is processed. Use the `final` message for the definitive prediction.

### final

Final prediction sent after `stop` message is received and all audio is processed.

**Message Format:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"final"` |
| `prediction` | string | Final prediction: `"real"` or `"fake"` |
| `confidence` | number | Final confidence score. Range: 0-1 |
| `total_audio_ms` | integer | Total milliseconds of audio analyzed |
| `total_processing_ms` | integer | Total server processing time in milliseconds |
| `server_session_id` | string | Server session ID for reference |
| `scores` | object | Optional detailed final scores (if `return_scores: true`) |
| `scores.real` | number | Final probability that audio is real. Range: 0-1 |
| `scores.fake` | number | Final probability that audio is fake. Range: 0-1 |

**Example:**

```json
{
  "type": "final",
  "prediction": "fake",
  "confidence": 0.91,
  "total_audio_ms": 15400,
  "total_processing_ms": 342,
  "server_session_id": "sess_01HX9KZQR2N8J5M3P7WXYZ",
  "scores": {
    "real": 0.09,
    "fake": 0.91
  }
}
```

### error

Error message sent when an issue occurs. Connection may close after error depending on severity.

**Message Format:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"error"` |
| `code` | string | Machine-readable error code (see Error Codes below) |
| `message` | string | Human-readable error description |
| `fatal` | boolean | If true, connection will close after this message |
| `server_session_id` | string | Server session ID (if session was started) |
| `details` | object | Optional additional error context |

**Example:**

```json
{
  "type": "error",
  "code": "invalid_encoding",
  "message": "Unsupported audio encoding: mp4",
  "fatal": true,
  "server_session_id": "sess_01HX9KZQR2N8J5M3P7WXYZ"
}
```

### pong

Response to client's `ping` message.

**Message Format:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Always `"pong"` |

**Example:**

```json
{
  "type": "pong"
}
```

## Error Codes

| Code | Fatal | Description | Suggested Action |
|------|-------|-------------|------------------|
| `authentication_failed` | Yes | Invalid or missing API key | Check API key and reconnect |
| `invalid_message_format` | No | Malformed JSON message | Fix message format and resend |
| `invalid_encoding` | Yes | Unsupported audio encoding | Use supported encoding and reconnect |
| `invalid_sample_rate` | Yes | Sample rate out of range | Use 8000-48000 Hz and reconnect |
| `missing_start_message` | Yes | Audio sent before start | Send start message first |
| `session_already_started` | No | Start message sent twice | Continue with current session |
| `invalid_sequence` | No | Sequence number not monotonic | Use correct sequence numbers |
| `audio_decode_failed` | No | Cannot decode base64/audio | Check audio encoding and format |
| `rate_limit_exceeded` | Yes | Too many concurrent sessions | Reduce concurrent sessions and retry |
| `session_timeout` | Yes | No messages for 30 seconds | Reconnect and start new session |
| `session_duration_exceeded` | Yes | Session exceeded 20 minutes | End session and start new one |
| `internal_error` | Yes | Server-side processing error | Retry with exponential backoff |

## Usage Examples

### JavaScript (Browser/Node.js)

```javascript
const ws = new WebSocket('wss://fraud-api.nuvoice.ai/v1/fraud/stream?api_key=YOUR_API_KEY');

ws.onopen = () => {
  // Start session
  ws.send(JSON.stringify({
    type: 'start',
    client_session_id: 'call_123',
    encoding: 'mulaw',
    sample_rate_hz: 8000,
    channels: 1,
    options: {
      return_scores: true,
      interim_interval: 1000
    }
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case 'started':
      console.log('Session started:', message.server_session_id);
      // Start sending audio chunks
      sendAudioChunks();
      break;

    case 'score':
      console.log(`Interim score [${message.seq}]: ${message.prediction} (${message.confidence})`);
      if (message.confidence > 0.85 && message.prediction === 'fake') {
        console.warn('High confidence fraud detected!');
      }
      break;

    case 'final':
      console.log(`Final prediction: ${message.prediction} (${message.confidence})`);
      ws.close();
      break;

    case 'error':
      console.error('Error:', message.code, message.message);
      if (message.fatal) {
        ws.close();
      }
      break;
  }
};

let audioSeq = 0;

function sendAudioChunks() {
  // Example: sending audio from a buffer
  const chunkSize = 1600; // ~200ms of mulaw @ 8kHz
  let offset = 0;

  const interval = setInterval(() => {
    if (offset >= audioBuffer.length) {
      // End of audio
      clearInterval(interval);
      ws.send(JSON.stringify({ type: 'stop', reason: 'audio_complete' }));
      return;
    }

    const chunk = audioBuffer.slice(offset, offset + chunkSize);
    const base64Audio = Buffer.from(chunk).toString('base64');

    ws.send(JSON.stringify({
      type: 'audio',
      seq: ++audioSeq,
      timestamp_ms: offset / 8, // 8 bytes per ms for mulaw @ 8kHz
      content: base64Audio
    }));

    offset += chunkSize;
  }, 200); // Send every 200ms
}

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onclose = () => {
  console.log('WebSocket closed');
};
```

### Python

```python
import asyncio
import websockets
import json
import base64

async def stream_audio_detection():
    uri = "wss://fraud-api.nuvoice.ai/v1/fraud/stream?api_key=YOUR_API_KEY"

    async with websockets.connect(uri) as websocket:
        # Start session
        start_msg = {
            "type": "start",
            "client_session_id": "call_123",
            "encoding": "mulaw",
            "sample_rate_hz": 8000,
            "channels": 1,
            "options": {
                "return_scores": True,
                "interim_interval": 1000
            }
        }
        await websocket.send(json.dumps(start_msg))

        # Wait for started message
        response = await websocket.recv()
        started = json.loads(response)
        print(f"Session started: {started['server_session_id']}")

        # Send audio chunks
        seq = 0
        with open('audio.mulaw', 'rb') as f:
            chunk_size = 1600  # ~200ms of mulaw @ 8kHz

            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break

                seq += 1
                audio_msg = {
                    "type": "audio",
                    "seq": seq,
                    "content": base64.b64encode(chunk).decode('utf-8')
                }
                await websocket.send(json.dumps(audio_msg))

                # Non-blocking receive of interim scores
                try:
                    response = await asyncio.wait_for(websocket.recv(), timeout=0.01)
                    score = json.loads(response)
                    if score['type'] == 'score':
                        print(f"Score [{score['seq']}]: {score['prediction']} ({score['confidence']:.2f})")
                except asyncio.TimeoutError:
                    pass

                await asyncio.sleep(0.2)  # 200ms between chunks

        # Stop session
        await websocket.send(json.dumps({"type": "stop"}))

        # Wait for final result
        response = await websocket.recv()
        final = json.loads(response)
        print(f"Final: {final['prediction']} (confidence: {final['confidence']:.2f})")

asyncio.run(stream_audio_detection())
```

### Integration with Twilio Media Streams

```javascript
const WebSocket = require('ws');
const express = require('express');

const app = express();

app.post('/voice', (req, res) => {
  res.type('text/xml');
  res.send(`
    <Response>
      <Start>
        <Stream url="wss://your-server.com/media-stream" />
      </Start>
      <Say>Please speak now.</Say>
      <Pause length="10"/>
    </Response>
  `);
});

const server = app.listen(3000);

const wss = new WebSocket.Server({ server });

wss.on('connection', (twilioWs) => {
  console.log('Twilio Media Stream connected');

  let fraudWs = null;
  let audioSeq = 0;

  twilioWs.on('message', (message) => {
    const msg = JSON.parse(message);

    if (msg.event === 'start') {
      // Connect to NuVoice Fraud API
      fraudWs = new WebSocket(
        'wss://fraud-api.nuvoice.ai/v1/fraud/stream?api_key=YOUR_API_KEY'
      );

      fraudWs.on('open', () => {
        fraudWs.send(JSON.stringify({
          type: 'start',
          client_session_id: msg.start.callSid,
          encoding: 'mulaw',
          sample_rate_hz: 8000,
          channels: 1,
          options: { return_scores: true }
        }));
      });

      fraudWs.on('message', (data) => {
        const fraudMsg = JSON.parse(data);

        if (fraudMsg.type === 'score') {
          console.log(`[${msg.start.callSid}] Score: ${fraudMsg.prediction} (${fraudMsg.confidence})`);

          // Take action if high confidence fraud detected
          if (fraudMsg.confidence > 0.9 && fraudMsg.prediction === 'fake') {
            console.warn('HIGH CONFIDENCE FRAUD DETECTED - Consider ending call');
            // Optionally disconnect the call via Twilio API
          }
        }

        if (fraudMsg.type === 'final') {
          console.log(`[${msg.start.callSid}] Final: ${fraudMsg.prediction} (${fraudMsg.confidence})`);
        }
      });
    }

    if (msg.event === 'media' && fraudWs) {
      // Forward Twilio's 20ms chunks directly - no buffering needed!
      // The fraud detection server handles buffering internally
      fraudWs.send(JSON.stringify({
        type: 'audio',
        seq: ++audioSeq,
        content: msg.media.payload // Already base64-encoded mulaw
      }));
    }

    if (msg.event === 'stop' && fraudWs) {
      fraudWs.send(JSON.stringify({ type: 'stop', reason: 'twilio_stop' }));
      fraudWs.close();
    }
  });

  twilioWs.on('close', () => {
    console.log('Twilio Media Stream disconnected');
    if (fraudWs) fraudWs.close();
  });
});
```

## Best Practices

### Audio Chunking

1. **Send as received**: Forward audio chunks immediately as you receive them (no client buffering needed)
2. **Any size works**: Chunks from 20ms (Twilio) to 1000ms all work fine
3. **Server buffers**: The server handles all buffering internally
4. **Real-time rate**: Send audio at real-time rate or faster (up to 10x for pre-recorded)

### Sequence Numbers

1. **Start at 1**: Begin sequence numbers at 1 (not 0)
2. **Monotonic**: Always increment by 1 for each audio message
3. **No Gaps**: Don't skip sequence numbers
4. **No Reuse**: Never reuse sequence numbers within a session

### Error Handling

1. **Fatal Errors**: Close connection and retry with exponential backoff
2. **Non-Fatal Errors**: Log error and continue if possible
3. **Decode Errors**: Verify audio encoding before sending
4. **Timeouts**: Implement keepalive pings if audio gaps exceed 10 seconds

### Connection Management

1. **Reconnection**: Implement exponential backoff (1s, 2s, 4s, 8s, max 30s)
2. **Keepalive**: Send ping messages if no audio for 15+ seconds
3. **Session Duration**: Sessions can run up to 20 minutes maximum
4. **Clean Shutdown**: Always send `stop` message before closing WebSocket

### Performance Optimization

1. **Connection Pooling**: For high-volume call centers, maintain pool of WebSocket connections
2. **Monitor Latency**: Track `processing_ms` to identify performance issues
3. **Early Detection**: Monitor interim scores to take action before call ends
4. **Use Case Selection**: Use REST API for single-shot verification, Streaming API for continuous monitoring

### Security

1. **API Keys**: Never expose API keys in client-side code
2. **Proxy Pattern**: Use a backend proxy to add authentication
3. **TLS**: Always use WSS (secure WebSocket), never WS
4. **Validation**: Validate server messages to prevent injection attacks

## Comparison with REST API

Both APIs provide real-time deepfake/fraud detection, but for different use cases:

| Feature | Streaming API | REST API |
|---------|---------------|----------|
| **Use Case** | Continuous call monitoring | Single-shot voice verification |
| **Audio Input** | Ongoing conversation | Spoken prompt/challenge phrase |
| **Duration** | Entire call (up to 20 min) | Short utterance (3-30 seconds) |
| **Results** | Incremental + Final | Single result |
| **Connection** | WebSocket (stateful) | HTTP (stateless) |
| **Decision Point** | During or after call | Before granting access |
| **Complexity** | Higher | Lower |

**When to use Streaming API:**
- **Continuous monitoring**: Detect fraud throughout an entire conversation
- **Live call surveillance**: Monitor phone calls, voice chats, customer service calls
- **Mid-call fraud detection**: Detect if speaker switches to AI voice during call
- **Real-time intervention**: Take action during call (e.g., terminate, alert agent)
- **Telephony integration**: Twilio, Vonage, or other voice platforms

**When to use REST API:**
- **Voice verification gate**: User speaks challenge phrase before access is granted
- **Authentication flows**: "Please say 'My voice is my password'" for login
- **One-time verification**: Check single utterance before proceeding
- **Enrollment screening**: Verify voice is real during account setup
- **Quick fraud check**: Analyze a short audio sample for immediate pass/fail decision

**Example Scenarios:**

*Streaming API*: Customer calls bank, conversation is monitored continuously. If high confidence fraud detected at any point during the 10-minute call, alert fraud team or terminate call.

*REST API*: User attempts to login via voice. System prompts "Please say: The quick brown fox jumps over the lazy dog." First the audio is sent to voice verification system. If the voice verification system authenticates the audio, it is then sent to fraud detection API, result returned in 200ms. If real, grant access. If fake, deny login or step up authentication as appropriate. 

## Rate Limits

- **Concurrent sessions**: 100 per API key
- **Messages per second**: 1000 per connection
- **Audio throughput**: 10x real-time (e.g., 10 minutes of audio per minute)
- **Session duration**: 20 minutes maximum

When limits are exceeded, you'll receive an `error` message with code `rate_limit_exceeded`.

## Troubleshooting

### Common Issues

**Problem**: Connection closes immediately after opening
- **Cause**: Invalid API key
- **Solution**: Verify API key in query parameter

**Problem**: `missing_start_message` error
- **Cause**: Sent audio before start message
- **Solution**: Always send start message first after connection opens

**Problem**: No score messages received
- **Cause**: Insufficient audio sent (need 3-5 seconds minimum) or encoding mismatch
- **Solution**: Ensure at least 3 seconds of audio has been sent and verify encoding matches `start` message

**Problem**: `session_timeout` error
- **Cause**: No messages sent for 30 seconds
- **Solution**: Send ping messages during audio gaps

**Problem**: Scores fluctuate wildly
- **Cause**: Normal behavior with limited audio
- **Solution**: Wait for more audio or use the final prediction

**Problem**: High latency in score messages
- **Cause**: Chunks too large or network issues
- **Solution**: Reduce chunk size, check network latency

### Getting Help

For issues or questions:
1. Check the `server_session_id` from started/final/error messages
2. Review connection logs for error codes
3. Contact support with session ID for faster troubleshooting

## Changelog

### Version 1.0.0 (Current)
- Initial release of Streaming API
- Support for all major audio formats
- Interim scoring with configurable intervals
- Twilio Media Streams integration support
