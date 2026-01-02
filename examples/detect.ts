// Pre-requisites (from project root):
//   npm install -g @openapitools/openapi-generator-cli 
//   openapi-generator-cli generate -i openapi.yaml -g typescript-node -o ./node-client
//
// API_KEY=abc123 BASE_URL=http://localhost:8000 npx tsx detect.js /path/to/audio.wav
import fs from 'node:fs';
import path from 'node:path';
import { DefaultApi } from '../node-client/api';
import { DetectRequest, AudioInput } from '../node-client/model/models';

// replace as necessary
const BASE_URL : string = process.env.BASE_URL || "http://fraud-api.nuvoice.ai:8000"

async function main() {
  // no API Key is needed if accessing from AWS
  const apiKey = process.env.NUVOICE_API_KEY || '';  

  const audioPath = process.argv[2];
  if (!audioPath) {
    throw new Error('Usage: npx ts-node examples/detect.ts /path/to/audio.wav');
  }

  const audioBytes = fs.readFileSync(path.resolve(audioPath));
  const request : DetectRequest = {
    sessionId: `demo_${Date.now()}`,
    audio: {
      content: audioBytes.toString('base64'),
      encoding: AudioInput.EncodingEnum.Wav, // change if using mulaw/pcm_s16le/mp3/etc.
      // sampleRateHz: 8000, // required for mulaw or pcm_s16le inputs
      // channels: 1,
    },
    options: {
      returnScores: true,
    },
  };

  const client = new DefaultApi(BASE_URL);
  client.accessToken = apiKey;

  const { body } = await client.detectFraud(request);
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
