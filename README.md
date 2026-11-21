# Voice Agent

Voice Agent is a distributed platform for building real-time, conversational AI experiences over live audio. It supports bidirectional voice streaming, speech recognition, LLM-driven dialogue, tool execution, speech synthesis, interruption handling, session monitoring, and post-call analytics.

The platform is designed for conversations that must feel immediate and natural. It coordinates the full voice loop—from detecting the end of a caller's turn to producing the first audible response—while preserving conversation context, handling failures, and exposing the telemetry needed to measure latency and reliability.

## Core capabilities

- **Bidirectional audio streaming** using WebRTC and WebSockets
- **Streaming speech recognition** with partial and final transcripts
- **LLM-driven conversations** with contextual, multi-turn dialogue
- **Streaming speech synthesis** for low time-to-first-audio
- **Turn detection** using voice activity and transcript events
- **Barge-in handling** that cancels an active response when the caller interrupts
- **Conversation context management** across turns and tool results
- **Automated tool execution** with validation, timeouts, and idempotency
- **Distributed session orchestration** across independently scalable services
- **Real-time transcription and monitoring** for active calls
- **Post-call processing** for summaries, analytics, scoring, and persistence
- **Latency benchmarking** across STT, LLM, tool, and TTS stages
- **End-to-end observability** through OpenTelemetry traces, metrics, and logs

## Architecture

```text
 Client / Telephony Provider
      microphone + speaker
               │
               │ WebRTC / WebSocket
               ▼
 ┌────────────────────────────┐
 │     Voice Gateway          │
 │ media, connections, auth   │
 └─────────────┬──────────────┘
               │ gRPC
               ▼
 ┌────────────────────────────┐        ┌───────────────────────┐
 │   Session Orchestrator     │◀──────▶│ Redis                 │
 │ state, turns, interruptions│        │ active session state  │
 └──────┬──────────┬──────────┘        └───────────────────────┘
        │          │
        │          └──────────────┐
        ▼                         ▼
 ┌──────────────┐     ┌────────────────────────────┐
 │ Streaming STT│     │ Conversation Runtime       │
 └──────┬───────┘     │ LLM, context, tool runner  │
        │             └─────────────┬──────────────┘
        │                           │
        └──────────────┬────────────┘
                       ▼
               ┌──────────────┐
               │ Streaming TTS│
               └──────┬───────┘
                      │ synthesized audio
                      ▼
               Voice Gateway

 Session completion
        │
        ▼
 ┌─────────────────────┐      ┌───────────────────────┐
 │ RabbitMQ            │─────▶│ Post-call Workers     │
 │ asynchronous events │      │ summaries + analytics │
 └─────────────────────┘      └───────────┬───────────┘
                                          ▼
                               ┌───────────────────────┐
                               │ PostgreSQL            │
                               │ calls, turns, metrics │
                               └───────────────────────┘
```

The media plane and control plane are intentionally separated. Audio remains on latency-sensitive streaming paths, while session commands, state transitions, transcripts, and tool results travel through typed control-plane interfaces.

## Conversation lifecycle

### 1. Session establishment

A client joins a LiveKit room or opens an authenticated WebSocket connection. The voice gateway creates a session, assigns media tracks, and registers the connection with the session orchestrator.

### 2. Audio ingestion and transcription

Incoming audio is streamed to the speech recognition provider. Partial transcripts support live monitoring, while final transcripts create durable conversation turns and trigger response generation.

### 3. Turn orchestration

The orchestrator validates each event against the current session phase, maintains the active turn, and produces actions for the conversation runtime. Event identifiers make transitions idempotent across retries and reconnects.

### 4. Response generation

The conversation runtime loads relevant context, streams tokens from the language model, and executes approved tools when required. Tool results are added to the conversation before response generation continues.

### 5. Speech synthesis and playback

Generated text is streamed to the speech synthesis provider. Audio frames are returned to the caller as soon as they are available instead of waiting for the complete response.

### 6. Interruption handling

If caller speech is detected while the agent is thinking or speaking, the active turn is cancelled. Pending LLM output, tool work where safe, queued TTS audio, and outbound playback are stopped before a new caller turn begins.

### 7. Post-call processing

When the session ends, an asynchronous event starts transcript persistence, summarization, sentiment and quality analysis, latency aggregation, and any downstream business workflow.

## Session state model

```text
                       final transcript
     ┌───────────┐ ─────────────────────────▶ ┌──────────┐
     │ LISTENING │                            │ THINKING │
     └─────▲─────┘ ◀───────────────┐          └────┬─────┘
           │                       │               │ response starts
           │ response completes    │               ▼
           │                 ┌─────┴───────┐  ┌──────────┐
           └─────────────────│ INTERRUPTED │◀─│ SPEAKING │
                             └─────────────┘  └──────────┘

       Any active phase ─────── session ends ───────▶ ENDED
```

Every transition carries a stable event ID and session version. The state store applies deduplication, validation, and version updates atomically, ensuring that network retries cannot generate duplicate responses or execute the same tool twice.

The orchestration layer emits explicit actions such as:

- `request_response`
- `cancel_response`
- `persist_transcript`
- `execute_tool`
- `publish_audio`
- `enqueue_post_call`

This keeps conversation policy independent from transports, storage engines, and AI providers.

## Major services

### Voice gateway

The TypeScript voice gateway owns client connectivity and the real-time media loop.

- Terminates authenticated WebSocket or WebRTC sessions
- Manages LiveKit rooms and media tracks
- Streams inbound audio to speech recognition
- Streams synthesized audio back to the caller
- Applies backpressure and frame sequencing
- Detects disconnects, reconnects, and media failures
- Propagates session, turn, and trace identifiers

### Session orchestrator

The Go orchestrator is the authority for conversation state.

- Maintains session and turn phases
- Enforces valid event ordering
- Handles interruption and cancellation
- Deduplicates retried events
- Coordinates context and response actions
- Persists ephemeral state in Redis
- Exposes typed gRPC interfaces to other services

### Conversation runtime

The conversation runtime coordinates model requests and tools.

- Builds prompts from system policy and conversation context
- Streams model output incrementally
- Validates structured tool calls
- Enforces per-tool permissions and deadlines
- Adds bounded tool results back into model context
- Rejects output from turns that are no longer active

### Post-call workers

RabbitMQ workers process work that does not belong on the real-time path.

- Generate call summaries
- Calculate latency and quality metrics
- Perform sentiment or outcome analysis
- Persist final transcripts and metadata
- Trigger integrations, webhooks, or CRM updates
- Retry failures through bounded retry queues and dead-letter queues

## Technology stack

| Technology | Role |
| --- | --- |
| **Go** | Session orchestration and latency-sensitive backend services |
| **Node.js / TypeScript** | Voice gateway, conversation runtime, integrations, and workers |
| **WebRTC** | Low-latency bidirectional media transport |
| **WebSockets** | Realtime client events, transcripts, and control messages |
| **gRPC / Protocol Buffers** | Typed internal service communication |
| **LiveKit** | WebRTC rooms, participants, and audio tracks |
| **Redis** | Ephemeral session state, event deduplication, and ownership leases |
| **PostgreSQL** | Calls, transcripts, tool results, and analytics |
| **RabbitMQ** | Asynchronous post-call workflows and event delivery |
| **Docker** | Reproducible services and local infrastructure |
| **OpenTelemetry** | Distributed traces, metrics, logs, and latency analysis |

## Realtime event model

The client protocol combines binary audio frames with typed control events.

### Client events

| Event | Purpose |
| --- | --- |
| `session.start` | Establish a new voice session |
| `input.audio.start` | Signal the beginning of caller speech |
| `input.audio.commit` | Commit the current utterance |
| `input.text` | Submit text through the same conversation pipeline |
| `input.interrupt` | Cancel the active agent turn |
| `session.end` | Close the session and start post-call processing |

### Server events

| Event | Purpose |
| --- | --- |
| `session.ready` | Confirm that the realtime session is available |
| `session.phase` | Report the current conversation phase |
| `transcript.partial` | Deliver an interim speech recognition result |
| `transcript.final` | Deliver the committed caller utterance |
| `agent.text` | Stream assistant response text |
| `agent.audio` | Stream synthesized audio frames |
| `tool.status` | Report tool execution progress or failure |
| `metrics.latency` | Report per-turn latency measurements |
| `error` | Report a recoverable or terminal session error |

Binary media frames include a protocol version, frame type, sequence number, capture timestamp, and codec metadata. This allows the gateway to detect dropped or reordered audio without decoding the payload.

## Service communication

Internal services communicate over gRPC using versioned Protocol Buffer contracts. Audio does not pass through orchestration RPCs; gRPC carries session events, transcripts, state snapshots, actions, and tool results.

RPC behavior follows several rules:

- Every state-changing request includes an idempotency key.
- Deadlines are mandatory and included in the latency budget.
- Retries are limited to safe, idempotent operations.
- W3C trace context is propagated through metadata.
- Message sizes are bounded to protect the control plane.
- Service-to-service identity is enforced with mTLS or workload identity.

## Context and tool execution

Conversation context combines recent turns, system policy, tool results, and retrieved knowledge. Context is bounded by a configurable token budget so long calls do not continuously increase response time and cost.

Tools execute through a controlled runner rather than directly inside model callbacks:

1. Validate the tool name against an allowlist.
2. Validate arguments against the tool's schema.
3. Assign an execution ID for deduplication.
4. Apply authorization, deadlines, and concurrency limits.
5. Execute the tool and sanitize its result.
6. Record metadata without leaking secrets.
7. Return a bounded result to the active model turn.

Side-effecting tools require explicit idempotency behavior and, where appropriate, user confirmation. A timed-out non-idempotent request is never retried blindly.

## Data model

PostgreSQL stores durable conversation data:

- **Calls** — lifecycle, participant, channel, status, and metadata
- **Conversation turns** — ordered user, agent, and tool messages
- **Tool executions** — arguments, status, duration, and bounded results
- **Call metrics** — latency percentiles, interruption count, and media quality
- **Post-call results** — summaries, outcomes, scores, and integration status

Redis stores short-lived operational state:

```text
session:{session_id}:state       active phase, version, and turn
session:{session_id}:events      processed event IDs
session:{session_id}:lease       gateway ownership and expiry
session:{session_id}:context     bounded working context
```

Raw audio belongs in encrypted object storage with an explicit retention deadline. PostgreSQL stores only its reference, duration, encryption metadata, and deletion status.

## Messaging topology

RabbitMQ separates asynchronous workloads from the real-time voice loop.

```text
exchange: voice-agent.events
  ├── call.started.v1
  ├── call.completed.v1 ─────▶ voice-agent.post-call.v1
  ├── transcript.ready.v1 ───▶ voice-agent.analytics.v1
  └── tool.completed.v1 ─────▶ voice-agent.integrations.v1

failed messages ─────────────▶ voice-agent.dead-letter.v1
```

Consumers acknowledge messages only after durable work completes. Jobs are idempotent on a stable job ID, retries are bounded, and poison messages are moved to a dead-letter queue for investigation.

## Observability

OpenTelemetry connects the full path of every voice turn:

```text
voice.session
└── voice.turn
    ├── audio.receive
    ├── stt.finalize
    ├── orchestrator.apply_event
    ├── context.load
    ├── llm.first_token
    ├── tool.execute
    ├── tts.first_audio
    └── audio.publish
```

Traces, metrics, and structured logs share `session_id`, `turn_id`, and `trace_id` correlation fields. Transcript text, audio, credentials, and sensitive tool arguments are excluded from telemetry by default.

Key service-level indicators include:

- Speech end to final transcript
- Final transcript to first model token
- First model token to first synthesized audio
- Speech end to first audible response
- Interruption to playback stop
- Audio frame loss and reorder rate
- Session establishment and reconnect success rate
- Tool success, timeout, and duplicate execution rate
- End-to-end latency at p50, p95, and p99

## Reliability

- Session ownership leases prevent concurrent writers.
- Atomic state transitions protect event ordering and deduplication.
- Late results are discarded when their turn is no longer active.
- Every streaming stage has a bounded buffer and backpressure policy.
- Provider calls carry deadlines and cancellation signals.
- Connection recovery resumes from the latest session version.
- PostgreSQL outbox records coordinate durable writes and event publication.
- Health and readiness probes distinguish process health from dependency health.
- Load shedding protects active calls when latency exceeds safe limits.

## Security and privacy

Voice conversations can contain personal, confidential, and biometric information. The platform treats audio and transcripts as sensitive data.

- TLS protects WebRTC, WebSocket, HTTP, and gRPC traffic.
- Room and session tokens are short-lived and scoped to one call.
- Internal workloads use mTLS or workload identity.
- Provider credentials are loaded from a secret manager.
- Audio, transcripts, and tool data are encrypted at rest.
- Recording requires explicit consent and visible retention policy.
- Logs and traces redact prompts, transcripts, credentials, and tool arguments.
- Rate, payload, duration, and concurrency limits protect public interfaces.
- Retention and deletion workflows cover audio, transcripts, context, and telemetry.

## Performance engineering

Voice responsiveness is measured as a pipeline rather than a single request duration. Each stage receives an explicit latency budget, and streaming is used wherever it shortens the critical path.

Benchmarks replay timestamped audio fixtures at controlled concurrency and capture:

- Warm and cold provider behavior
- Network jitter, loss, and reordering
- Short and long utterances
- Responses with and without tools
- Concurrent session saturation
- Cancellation and interruption latency
- Provider timeout and recovery behavior

Results are reported with sample count, error rate, hardware profile, and p50/p95/p99 distributions. This makes regressions visible and keeps performance goals tied to the caller's experience.

## Design principles

- Keep media transport separate from session control.
- Make turn identity, ordering, and cancellation explicit.
- Stream audio, transcripts, model output, and synthesis results.
- Keep provider integrations behind replaceable interfaces.
- Use ephemeral storage for active state and durable storage for history.
- Move non-critical work off the real-time path.
- Design every state-changing operation for retries and deduplication.
- Treat latency, observability, privacy, and failure handling as product features.

## Use cases

- AI customer support and contact-center assistants
- Appointment scheduling and qualification agents
- Interactive voice response modernization
- Sales and lead qualification calls
- Voice-enabled product copilots
- Real-time interview and coaching systems
- Internal helpdesk and operations assistants
- Multilingual conversational applications

Voice Agent provides the infrastructure and orchestration model required to turn streaming speech, language models, tools, and synthesized audio into reliable real-time conversations.
