import type { ServerEvent, SessionPhase } from "../../../packages/contracts/src/events.ts";

export type Emit = (event: ServerEvent) => void;

export interface Orchestrator {
  open(sessionId: string): Promise<void>;
  event(sessionId: string, kind: string, payload?: Record<string, string>): Promise<void>;
}

export class ConversationPipeline {
  private phase: SessionPhase = "idle";
  private active?: AbortController;
  private turn = 0;
  private ended = false;

  constructor(
    private readonly sessionId: string,
    private readonly emit: Emit,
    private readonly orchestrator: Orchestrator,
    private readonly delayMs = 180,
  ) {}

  async start() {
    await this.orchestrator.open(this.sessionId);
    this.setPhase("listening");
  }

  async respond(input: string) {
    this.interrupt(false);
    const controller = new AbortController();
    this.active = controller;
    const turnId = `turn-${++this.turn}`;
    const started = performance.now();

    this.emit({ type: "transcript.final", text: input });
    this.setPhase("thinking");
    await this.orchestrator.event(this.sessionId, "transcript_final", { turnId, text: input });

    await wait(this.delayMs, controller.signal);
    if (controller.signal.aborted) return;

    const firstTokenMs = Math.round(performance.now() - started);
    const answer = mockAnswer(input);
    await this.orchestrator.event(this.sessionId, "response_started", { turnId });
    this.setPhase("speaking");
    this.emit({ type: "agent.text", text: answer });

    await wait(this.delayMs, controller.signal);
    if (controller.signal.aborted) return;

    await this.orchestrator.event(this.sessionId, "response_finished", { turnId });
    if (this.active === controller) this.active = undefined;
    this.setPhase("listening");
    this.emit({
      type: "metrics.latency",
      turnId,
      firstTokenMs,
      totalMs: Math.round(performance.now() - started),
    });
  }

  interrupt(notify = true) {
    if (!this.active || this.active.signal.aborted) return;
    this.active.abort();
    this.active = undefined;
    if (notify) void this.orchestrator.event(this.sessionId, "interrupted");
    if (notify) {
      this.setPhase("interrupted");
      queueMicrotask(() => this.setPhase("listening"));
    }
  }

  async end() {
    if (this.ended) return;
    this.ended = true;
    this.interrupt(false);
    await this.orchestrator.event(this.sessionId, "session_ended");
    this.setPhase("ended");
  }

  private setPhase(phase: SessionPhase) {
    this.phase = phase;
    this.emit({ type: "session.phase", phase });
  }
}

function mockAnswer(input: string) {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (/latency/i.test(normalized)) {
    return "This turn is timed from the final transcript to the response. The latency card shows the measured mock pipeline timings.";
  }
  if (/architecture|work/i.test(normalized)) {
    return "Audio enters over WebSocket, the Go orchestrator advances conversation state, and provider adapters perform transcription, reasoning, and speech synthesis.";
  }
  return `I heard “${normalized}”. This response came from the deterministic demo LLM adapter, so no cloud credentials were required.`;
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

