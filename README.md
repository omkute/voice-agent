# Voice Agent Platform

A runnable, production-shaped scaffold for a low-latency voice agent. The demo streams microphone chunks over a WebSocket, moves each conversation through a Go session state machine, generates a deterministic mock response, speaks it in the browser, and reports turn latency. It requires no AI-provider credentials.

The repository is intentionally split between a **working local demo** and **production seams**. The demo uses in-memory state, an HTTP adapter to the Go orchestrator, and mock STT/LLM/TTS behavior. The protobuf contract, LiveKit, Redis, PostgreSQL, RabbitMQ, container definitions, and database schema show where production adapters connect without hiding unfinished integrations.

## What works today

- Bidirectional browser session over WebSocket
- Live microphone chunk streaming with partial activity feedback
- Text input for deterministic testing
- Conversation phases: listening, thinking, speaking, interrupted, ended
- Barge-in/interruption cancellation
- Idempotent, atomic Go session transitions
- Mock transcription, LLM response, and browser speech synthesis
- First-token and end-to-end latency measurements
- Versioned gRPC/protobuf orchestration contract
- RabbitMQ post-call worker scaffold
- PostgreSQL call, transcript, and metric schema
- Docker Compose definitions for LiveKit, Redis, RabbitMQ, and PostgreSQL
- TypeScript and Go unit tests

## Architecture

```text
 Browser / caller
  microphone + speaker
          │
          │ WebRTC in production
          │ WebSocket in this demo
          ▼
 ┌──────────────────────────┐
 │ TypeScript Voice Gateway │
 │ transport + voice loop   │
 └────────────┬─────────────┘
              │ HTTP in demo / gRPC contract for production
              ▼
 ┌──────────────────────────┐       ┌──────────────────────┐
 │ Go Session Orchestrator  │──────▶│ Redis session state  │
 │ turns + interrupts       │       └──────────────────────┘
 └──────┬───────────┬───────┘
        │           │
        │           └──────────────▶ STT → LLM/tools → TTS
        │                              provider adapters
        ▼
 ┌──────────────────────────┐       ┌──────────────────────┐
 │ RabbitMQ post-call queue │──────▶│ Analytics worker     │
 └──────────────────────────┘       └──────────┬───────────┘
                                               ▼
                                      ┌────────────────────┐
                                      │ PostgreSQL         │
                                      │ calls/transcripts  │
                                      └────────────────────┘
```

The orchestration module exposes one small interface: open a session, apply an event, or close it. Ordering, phase validation, idempotency, active-turn tracking, and resulting actions remain inside the module. This keeps transports and AI providers replaceable and makes the same interface the natural test surface.

### Request path in the demo

1. The browser opens `ws://localhost:3000/ws`.
2. Holding the microphone button sends `MediaRecorder` chunks as binary WebSocket frames.
3. Releasing the button commits the buffered utterance. The demo STT adapter reports a deterministic transcript based on received audio duration.
4. The gateway sends `transcript_final` to the Go orchestrator.
5. The orchestrator advances the session to `thinking` and returns actions that a production runtime would use to persist the transcript and request an LLM response.
6. The mock LLM emits a response; the orchestrator moves through `speaking` and back to `listening`.
7. Browser `SpeechSynthesis` acts as the demo TTS adapter, and the UI displays latency.
8. Starting a new utterance during an active response aborts the old turn and records an interruption.

## Repository layout

```text
apps/voice-gateway/              Bun/TypeScript WebSocket gateway and demo UI
  public/index.html              Browser console and microphone client
  src/pipeline.ts                Conversation pipeline and mock AI adapters
  src/orchestrator.ts            Orchestration transport adapter
services/orchestrator/           Go session orchestration module
  cmd/server/                    Demo HTTP transport
  internal/session/              State machine, actions, idempotency
services/post-call-worker/       RabbitMQ analytics worker scaffold
packages/contracts/
  proto/orchestrator.proto       Versioned production gRPC contract
  src/events.ts                  Browser/gateway event types
infra/
  livekit.yaml                   Local LiveKit configuration
  postgres/migrations/           Durable call and analytics schema
scripts/dev.ts                   Starts the two demo processes
docker-compose.yml               Local platform dependencies and apps
```

## Prerequisites

For the credential-free demo:

- [Bun](https://bun.sh/) 1.3 or newer
- Go 1.24 or newer
- A current Chromium, Firefox, or Safari browser

For the full local infrastructure, install Docker with Compose v2 as well. Microphone access works on `localhost`; deployed browsers require HTTPS.

## Quick start

```bash
cp .env.example .env
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000), type a message, or hold the circular microphone button while speaking. The two local processes are:

| Process | Address | Purpose |
| --- | --- | --- |
| Voice gateway | `http://localhost:3000` | UI, WebSocket transport, mock voice pipeline |
| Orchestrator | `http://localhost:8081` | Session state and turn actions |

`Ctrl+C` stops both processes. If port `3000` or `8081` is occupied, set `GATEWAY_PORT` or `ORCHESTRATOR_PORT` before starting.

### Run with Docker Compose

```bash
docker compose up --build
```

This starts the demo applications plus:

| Dependency | Address | Credentials |
| --- | --- | --- |
| PostgreSQL | `localhost:5432` | `voice_agent` / `voice_agent` |
| Redis | `localhost:6379` | none (development only) |
| RabbitMQ AMQP | `localhost:5672` | `voice_agent` / `voice_agent` |
| RabbitMQ UI | [localhost:15672](http://localhost:15672) | `voice_agent` / `voice_agent` |
| LiveKit | `ws://localhost:7880` | `devkey` / `secret` |
| OpenTelemetry OTLP | `localhost:4317` / `localhost:4318` | none |

The checked-in secrets are explicitly local development values. Never reuse them in a deployed environment.

## Commands

```bash
bun run dev                 # run gateway and orchestrator with gateway reload
bun run dev:gateway         # run only the TypeScript gateway
bun run dev:orchestrator    # run only the Go orchestrator
bun run test                # TypeScript and Go tests
bun run check               # strict TypeScript check and Go tests
bun run worker              # start RabbitMQ post-call worker
make infra-up               # start only local dependencies
make infra-down             # stop Compose resources
```

## Realtime protocol

The WebSocket carries UTF-8 JSON control events and binary encoded audio chunks. Each JSON object has a `type` discriminator.

Client events:

| Type | Fields | Meaning |
| --- | --- | --- |
| `input.audio.start` | none | Begin an utterance; interrupts an active agent turn |
| binary frame | encoded audio bytes | One microphone chunk |
| `input.audio.commit` | none | Finish the utterance and request processing |
| `input.text` | `text` | Bypass demo STT with deterministic text input |
| `input.interrupt` | none | Explicitly cancel the active turn |
| `session.end` | none | End the session and trigger post-call work |

Server events:

| Type | Important fields | Meaning |
| --- | --- | --- |
| `session.ready` | `sessionId`, `phase` | Transport is ready |
| `session.phase` | `phase` | State machine changed phase |
| `transcript.partial` | `text` | Non-final recognition/activity update |
| `transcript.final` | `text` | Committed user utterance |
| `agent.text` | `text` | Assistant response text |
| `agent.audio` | `audio`, `mimeType` | Reserved for encoded production TTS frames |
| `metrics.latency` | `firstTokenMs`, `totalMs` | Per-turn responsiveness |
| `error` | `code`, `message` | Recoverable pipeline error |

For a production stream, prefer binary frames with a compact header containing protocol version, frame kind, sequence number, timestamp, and codec. Keep control messages JSON or protobuf. Sequence numbers allow dropped/reordered frame metrics without interpreting audio.

## Session state model

```text
              final transcript
  LISTENING ───────────────────▶ THINKING
      ▲                              │
      │                              │ response started
      │ response finished            ▼
      └────────────────────────── SPEAKING
                                      │
                                      │ caller speech / interrupt
                                      ▼
                                  INTERRUPTED ──▶ LISTENING

  Any non-ended phase ── session ended ──▶ ENDED
```

Every state-changing event carries an `eventId`. The Go store remembers processed IDs and returns the current snapshot for duplicates without rerunning actions. In production, Redis should make the transition, version increment, and deduplication write atomic (typically one Lua script or a transaction with optimistic version checking).

The state machine produces actions instead of directly calling infrastructure:

- `request_response`
- `cancel_response`
- `persist_transcript`
- `enqueue_post_call`

That separation keeps conversation policy independent of gRPC, Redis, AI vendors, and RabbitMQ.

## Internal orchestration transports

The demo uses HTTP to avoid requiring generated protobuf tools for first run:

```bash
curl -X POST http://localhost:8081/v1/sessions/demo-1

curl -X POST http://localhost:8081/v1/sessions/demo-1/events \
  -H 'content-type: application/json' \
  -d '{"eventId":"evt-1","kind":"transcript_final","turnId":"turn-1","text":"Hello"}'

curl http://localhost:8081/v1/sessions/demo-1
```

The production interface is defined in `packages/contracts/proto/orchestrator.proto`. Generate Go and TypeScript clients in CI with pinned `buf`/`protoc` plugins, commit or publish the generated package, then replace `HttpOrchestrator` with the gRPC adapter. The state module itself does not change.

Recommended gRPC behavior:

- Deadlines: 100–250 ms for session events
- Retry only unavailable/idempotent requests, keyed by `event_id`
- Propagate W3C trace context through metadata
- Enforce message-size limits; audio should stay on the media plane
- Use mTLS or workload identity between deployed services

## Production adapter plan

| Concern | Demo adapter | Production adapter |
| --- | --- | --- |
| Media ingress/egress | Browser WebSocket + `MediaRecorder` | LiveKit room tracks over WebRTC |
| Speech recognition | Audio-duration mock | Streaming STT provider with partial/final results |
| LLM | Deterministic local function | Streaming model client with tool calling |
| Speech synthesis | Browser `SpeechSynthesis` | Streaming TTS audio into LiveKit track |
| Session state | In-memory Go map | Redis atomic state repository with TTL |
| Orchestration RPC | HTTP/JSON adapter | Generated gRPC client/server |
| Durable history | Schema only | PostgreSQL repository/batched writer |
| Post-call jobs | Worker scaffold | RabbitMQ publisher, retries, DLQ, idempotent consumers |

Provider adapters should accept an `AbortSignal`/context. When barge-in occurs, cancel the LLM stream first, flush queued TTS frames, and stop the outbound media track before acknowledging the transition. This prevents stale speech after the caller has resumed.

## Tool execution

Model-requested tools should not execute directly inside the LLM stream callback. A production tool runner should:

1. Validate the tool name and JSON arguments against an allowlisted schema.
2. Assign a stable execution ID for deduplication.
3. Apply per-tool deadlines and concurrency limits.
4. Redact secrets and sensitive arguments from logs and traces.
5. Record request/result metadata in the conversation context.
6. Return a bounded result to the model or a safe user-facing failure.

Long-running or side-effecting tools need confirmation policy and compensating behavior. Never retry a non-idempotent tool merely because an RPC deadline expired.

## Data and retention

PostgreSQL migrations create:

- `calls`: durable lifecycle and metadata
- `conversation_turns`: ordered user, agent, and tool transcripts
- `call_metrics`: aggregate latency and reliability measures

Raw audio should normally live in object storage rather than PostgreSQL. Store only an object reference, encryption metadata, duration, and retention deadline. Define deletion workflows for audio, transcripts, model context, and trace attributes; voice data can contain sensitive and biometric information.

Redis keys should have bounded lifetimes, for example:

```text
session:{session_id}:state       JSON/hash, TTL refreshed while active
session:{session_id}:events      deduplication IDs, same TTL
session:{session_id}:lease       gateway ownership with short TTL
```

## Queue topology

A useful RabbitMQ production topology is:

```text
exchange: voice-agent.events (topic, durable)
  routing key: call.completed.v1
  queue: voice-agent.post-call.v1
  dead-letter queue: voice-agent.post-call.dlq.v1
```

Consumers must be idempotent on `jobId` or `(sessionId, jobType, version)`. Acknowledge only after durable writes finish. Use delayed retries with bounded attempts rather than immediate requeue loops.

## Observability and latency

Instrument the gateway and orchestrator with OpenTelemetry traces, metrics, and structured logs. Carry `session_id`, `turn_id`, and `trace_id` as correlation fields, but keep raw transcript/audio content out of telemetry by default.

Recommended spans:

```text
voice.turn
├── stt.finalize
├── orchestrator.apply_event
├── context.load
├── llm.first_token
├── tool.execute (zero or more)
└── tts.first_audio
```

Recommended service-level indicators:

- Time from speech end to final transcript
- Final transcript to first model token
- First model token to first synthesized audio frame
- End of caller speech to first audible response (p50/p95/p99)
- Interruption-to-playback-stop latency
- Audio frame loss/reorder rate
- Session setup success and unexpected disconnect rate
- Tool success, timeout, and duplicate execution rates

The demo's latency card measures final transcript → mock first token and final transcript → completed response. It is a pipeline sanity check, not a media quality benchmark.

### Benchmark method

For repeatable benchmarks, replay timestamped PCM fixtures instead of a live microphone, inject fixed provider latency distributions, and record results by commit. Include warm and cold runs, concurrent session counts, packet loss/jitter, response length, and tool usage. Report percentiles, sample count, errors, and hardware rather than only an average.

## Reliability considerations

- Use a session ownership lease so only one gateway writes a session at a time.
- Resume from the latest Redis version after gateway reconnects.
- Bound every queue between media, STT, LLM, and TTS; choose an explicit drop/backpressure policy.
- Discard late results whose `turn_id` is no longer active.
- Make event handling idempotent across gRPC retry and process restart.
- Use an outbox when publishing RabbitMQ events from a PostgreSQL state change.
- Add health checks for process liveness and readiness checks for required dependencies.
- Shed load before tail latency makes all active calls unusable.

## Security checklist

- Terminate TLS for WebSocket/WebRTC and use mTLS or workload identity internally.
- Authenticate room/session tokens and scope them to one call with a short expiry.
- Put all provider credentials in a secret manager, never client code or images.
- Validate event sizes, rate-limit sessions, and enforce audio duration limits.
- Treat transcript, audio, and tool data as sensitive; encrypt in transit and at rest.
- Redact authorization headers, prompts, transcripts, and tool arguments from logs.
- Require explicit consent for recording and document retention/deletion behavior.
- Run containers as non-root with read-only filesystems where possible.

## Testing strategy

Current tests cover complete turns, interruption cancellation, state transitions, generated actions, and duplicate event handling.

```bash
bun run test
```

The next valuable layers are:

1. Contract tests that replay the same event fixtures through HTTP and gRPC adapters.
2. Integration tests using disposable Redis, RabbitMQ, and PostgreSQL containers.
3. Browser tests for microphone permission, reconnect, and playback cancellation.
4. Load tests with synthetic audio and hundreds of concurrent sessions.
5. Failure injection for provider timeouts, reordered events, process restarts, and queue redelivery.

## Roadmap

- Generate and wire the gRPC clients/server from the included protobuf contract
- Add Redis session and lease adapters
- Add LiveKit room/token service and media-track worker
- Implement streaming STT, LLM tool calling, and streaming TTS adapters
- Persist calls through an outbox and publish post-call jobs
- Export OpenTelemetry data to a collector and add dashboards
- Add authentication, quotas, consent, retention, and deployment manifests

## Design principles

- Keep the media plane separate from the control plane.
- Make turn identity and cancellation explicit everywhere.
- Keep the orchestration interface small while hiding ordering and consistency rules inside it.
- Make external providers adapters, not conversation policy.
- Prefer deterministic local fakes for development and contract tests.
- Treat latency budgets and failure behavior as product requirements, not afterthoughts.

This scaffold is suitable for a portfolio demo, architectural spike, or the starting point for a production implementation. The mock labels are deliberate: replacing them should be a sequence of adapter changes, not a rewrite of session behavior.
