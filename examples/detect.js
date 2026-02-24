// This file provides example of how to call the API directly without the node-client library
// Replace test-token with your API KEY
const fs = require('fs');
const API_KEY = "test-token";
async function detectFraud() {
  const url = 'https://fraud-api.nuvoice.ai:8000/v1/fraud/detect';
  // process.argv[0] is 'node'
  // process.argv[1] is the script name
  // process.argv[2] will be your file path
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: node detect.js <path-to-audio-file>');
    process.exit(1);
  }

    // Check if file exists before trying to read it
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

  try {
    console.log(`Reading file: ${filePath}...`);
    
    // 1. Read the file directly into a Buffer
    const audioBuffer = fs.readFileSync(filePath);
    
    // 2. Convert that Buffer to a Base64 string
    // At 203KB, this is very fast and safe in Node memory
    const base64Audio = audioBuffer.toString('base64');

    // 3. Construct your JSON payload
    const payload = {
      audio: {
        content: base64Audio,
        encoding: 'wav'
      },
      options: {
        return_scores: true
      }
    };

    console.log('Sending POST request...');

    // 4. Send the request using the native fetch API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // 5. Check if the server liked it
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server Error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    console.log('--- Detection Result ---');
    console.log(JSON.stringify(data, null, 2));

  } catch (error) {
    console.error('Failed to process audio:', error.message);
  }
}

detectFraud();