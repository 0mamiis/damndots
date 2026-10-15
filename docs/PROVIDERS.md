# Model providers (custom API)

Dots routes Codex's model requests through its own **model gateway** (`/model-gateway/responses`). The provider (API address, key, API format) can be changed while Dots is running under **Settings → Model providers**; the Codex app-server does not need to restart.

## Adding a provider

1. Settings → **+ Add provider**: name, API address (for example `https://api.openai.com/v1`), API key and API format.
2. On save, models are fetched automatically with `GET {address}/models`. If the address was entered without `/v1`, `/v1` is tried automatically. If the list cannot be fetched, you can type the models by hand.
3. **Test connection** sends a small request to both `/responses` and `/chat/completions`, reports which format works and applies the suitable one with one click.
4. **Use this** activates the provider; new requests go to it immediately.

## API formats

- **Responses API**: requests are forwarded unchanged.
- **Chat Completions**: Codex's Responses request is translated on the server into a `/chat/completions` request. Streaming (SSE), tool calls (function and free-form tools), reasoning text and usage information are translated back into Responses events. Tool types with no chat equivalent (web_search, local_shell) are not sent in this format. If a model writes its answer only into the reasoning field, that text is shown as the answer.

## Model, reasoning level and Fast mode

- The model is chosen from the fetched list everywhere (Settings, Dot profile, new Dot, new task). "Type a custom model name…" lets you enter a name that is not in the list.
- Reasoning level options are the levels the provider reports per model (for example `reasoning_efforts`). If it reports none, low/medium/high are offered, and the choice is disabled for models that say they do not support it.
- **Fast mode** (`service_tier=priority`) is offered only for GPT model IDs. The server also refuses to assign Fast mode to a non-GPT model; if a Dot or setting moves to a non-GPT model, Fast mode turns off automatically.

## Security

- The API key is stored encrypted with AES-256-GCM, is never returned in any API response (only a `hasKey` flag) and is never logged.
- Remote provider addresses require HTTPS; local addresses may use HTTP. Redirects are rejected.
- The model gateway is authorized with a separate key derived from the signing key (the admin key is not used).

Provider configuration is verified by `apps/server/test/providers.test.ts` (encryption, redaction, model discovery, format translation, the Fast mode rule).
