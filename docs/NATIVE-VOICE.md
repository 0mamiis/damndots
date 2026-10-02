# Native Your Dot voice

The native call button has a distinct WebRTC path. The extracted desktop client `app-initial-fd3c4b862660.js`, class `jCo`, performs these requests:

1. `POST /tbo/{tbo_id}/voice/calls` with JSON `{ "sdp": "<audio SDP offer>", "debug_prompt_overrides": {} }`. The response is the **actual provider SDP answer**, `Content-Type: application/sdp`, and a `Location` whose final segment matches `rtc_<id>`.
2. The client applies that answer to its peer connection, then sends `POST /tbo/{tbo_id}/voice/calls/{call_id}/attach`. The gateway waits for the provider sideband to acknowledge `session.update` before returning `{}`.
3. The client releases microphone input when attached and waits for a real WebRTC connection. Provider-generated audio arrives on the negotiated media track.
4. Ending the call sends `POST /tbo/{tbo_id}/voice/calls/{call_id}/stop`. The gateway calls the provider's actual hangup endpoint before returning `{}` and marking the call stopped.

The native client's call media callback ignores data-channel events. This makes standard Realtime media usable without pretending to implement the private GPT-Live delegation schema. The gateway handles tool calls and transcripts through its authenticated server sideband.

## Provider setup

Configure an enabled voice provider in the dashboard or authenticated voice-settings API:

```json
{
  "enabled": true,
  "apiUrl": "https://api.openai.com/v1",
  "apiKey": "<provider key>",
  "realtimeModel": "gpt-realtime-1.5",
  "voice": "coral"
}
```

Use a Realtime model and voice supported by the configured provider and credentials. A text-only Gemini/OpenAI-compatible chat endpoint is insufficient. Transcription/TTS-only compatibility is also insufficient: the native microphone/player requires WebRTC negotiation, an authenticated Realtime sideband, and hangup support. Changing the dot's text model does not grant audio-model access.

Required provider operations:

- `POST {apiUrl}/realtime/calls`: authenticated multipart `sdp` and JSON `session`; actual SDP answer and `Location: .../rtc_<id>`.
- `WS(S) {apiUrl}/realtime?call_id={call_id}`: authenticated sideband; acknowledge accepted configuration with `session.updated`; stream transcription and function-call events.
- `POST {apiUrl}/realtime/calls/{call_id}/hangup`: terminate the actual WebRTC call.
- Optional `WS(S) {apiUrl}/realtime?model={model}`: primary audio transport for `thread/realtime/appendAudio`.

API keys remain encrypted in integration settings. `IntegrationService.getRealtimeConfiguration()` is a server-internal credential reader; it must never be returned by an HTTP handler. Provider rejection text is not returned to clients because upstream error strings can contain sensitive information.

Native calls use the same enrollment authorization as the other native endpoints. Remote provider URLs require HTTPS. Audio media travels directly between the native client and audio provider; the server carries SDP, sideband control, transcripts, and tool results.

## Runtime behavior

Voice exposes `dot_submit_task`, `dot_read_tasks`, `dot_read_memory`, and `end_voice_call`. Work requests become ordinary durable channel tasks with `channel: voice` and a request ID scoped to the provider call and function-call ID. Duplicate function completion events execute only once. The voice assistant receives real task results; file/computer/app work goes through the existing task runner and its approval workflow. Ending a call releases the voice wait while already submitted durable work continues.

Call allocation, attachment, errors, transcripts, submitted task IDs, and stop outcomes become real runtime activities and events. Only genuine provider hangup success marks a requested stop completed. A sideband disconnect triggers a provider hangup; a failed hangup stays visibly failed. Server restart recovery terminates stale persisted calls instead of claiming that their media connection is still active.

The gateway's `active` call state means an acknowledged provider control session. Native WebRTC media connectivity is determined by the native client. It is not proven by the server's sideband state.

## Optional generic thread voice

The extracted thread client also uses `/wham/realtime/calls` and App Server `thread/realtime/*` methods. `NativeVoiceService.handleRpc(method, params, notify)` handles:

- `start` with `existingCall`, `webrtc`, or primary `websocket` transport;
- `stop`, `appendText`, `appendSpeech`, `appendAudio`, and `listVoices`;
- `started`, `sdp`, transcript delta/done, output-audio delta, error/closed, and raw item notifications.

Intercept these methods before forwarding other native RPC requests to Codex App Server. `/wham/realtime/calls` requires an existing dot-owned `Thread-Id`; it uses the configured provider/model rather than accepting client-supplied provider credentials. The adapter emits version `v1`, which accurately identifies its standard Realtime event mapping. It does not claim the private `v3` Live protocol.

Primary WebSocket audio uses actual mono PCM16 at 24 kHz. Invalid rates/channel counts are rejected. WebRTC omits explicit audio format fields so SDP negotiates the media format.

## Verification and limits

`apps/server/test/native-voice.test.ts` uses a controlled local HTTP and WebSocket provider to verify native request/response contracts, credential isolation, session readiness, actual provider hangup, failure behavior, byte-preserving PCM forwarding, native notification schemas, task deduplication, and restart recovery.

The controlled peer's SDP is a **test fixture**, not proof of an Internet media connection. Genuine microphone capture, negotiated audio playback, model authorization, provider billing, and end-to-end native button acceptance require a configured compatible audio provider and a native test profile. No missing provider configuration is converted into fake SDP or a successful call.

Official protocol references:

- [Realtime WebRTC unified call creation](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Realtime sideband control](https://developers.openai.com/api/docs/guides/realtime-server-controls)
- [Realtime conversation events and function calling](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [Hang up a real Realtime call](https://developers.openai.com/api/reference/python/resources/realtime/subresources/calls/methods/hangup)
- [Codex App Server and generated version-specific schemas](https://learn.chatgpt.com/docs/app-server)

App Server realtime payloads were checked against the installed `codex.exe app-server generate-json-schema --experimental` output. The extracted desktop UI is the primary source for the private `/tbo` and `/wham` route formats.
