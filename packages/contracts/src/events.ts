export type SessionPhase =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "ended";

export type ClientEvent =
  | { type: "session.start"; sessionId?: string }
  | { type: "input.audio.start" }
  | { type: "input.audio.commit" }
  | { type: "input.text"; text: string }
  | { type: "input.interrupt" }
  | { type: "session.end" };

export type ServerEvent =
  | { type: "session.ready"; sessionId: string; phase: SessionPhase }
  | { type: "session.phase"; phase: SessionPhase }
  | { type: "transcript.partial"; text: string }
  | { type: "transcript.final"; text: string }
  | { type: "agent.text"; text: string }
  | { type: "agent.audio"; audio: string; mimeType: string }
  | { type: "metrics.latency"; turnId: string; totalMs: number; firstTokenMs: number }
  | { type: "error"; code: string; message: string };

