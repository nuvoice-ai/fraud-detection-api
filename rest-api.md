# REST API

The REST API can be used for one-shot detection where you pass in an audio sample and get a `real` vs. `fake` classification together with a `confidence` score.

Here is an example:

```bash
curl -X POST http://fraud-api.nuvoice.ai:8000/v1/fraud/detect \
  -H "Authorization: Bearer test-token" \
  -H "Content-Type: application/json" \
  -d '{
    "audio": {"content": "ZmFrZV9iYXNlNjRfYXVkaW8...", "encoding": "wav", "sample_rate_hz": 16000},
    "options": {"return_scores": true}
  }'
```

No API Key/token is required if accessing the API from AWS via PrivateLink. You pass in the audio as base64 encoded string in the `content` field. The `encoding` tells the `codec` used to encode the audio and you can also specify a `sample_rate_hz` telling the sample rate.

The REST API uses a structured request-response schema following an [OpenAPI](https://www.openapis.org/) specification that is documented in [openapi.yaml](openapi.yaml).

You can use this schema to generate strongly-typed clients in your favorite programming language if you don't want to make direct http calls.
For example, to generate a Node.js client run:

```
npx openapi-generator-cli generate -i openapi.yaml -g typescript-node -o ./node-client
```

Refer [openapi-generator](https://github.com/OpenAPITools/openapi-generator) for more. Be aware that the generator is not without its bugs and sometimes the best
way out is to access the API directly rather than spending time fixing bugs in the generator or its generated code.

Refer [API reference](API_Reference.md) for full details of the request-response related to the REST API.

The [examples](examples) folder contains an example demonstrating how to access the API from a strongly typed Node.js client.