import { describe, expect, test } from "bun:test";
import type { ServerEvent } from "../../../packages/contracts/src/events.ts";
import { ConversationPipeline, type Orchestrator } from "./pipeline.ts";

class FakeOrchestrator implements Orchestrator {
  events: string[] = [];
  async open() {}
  async event(_sessionId: string, kind: string) { this.events.push(kind); }
}

describe("ConversationPipeline", () => {
  test("emits a complete turn and latency", async () => {
    const emitted: ServerEvent[] = [];
    const orchestrator = new FakeOrchestrator();
    const pipeline = new ConversationPipeline("s1", (event) => emitted.push(event), orchestrator, 0);
    await pipeline.start();
    await pipeline.respond("hello");

    expect(orchestrator.events).toEqual(["transcript_final", "response_started", "response_finished"]);
    expect(emitted.some((event) => event.type === "agent.text")).toBe(true);
    expect(emitted.at(-1)?.type).toBe("metrics.latency");
  });

  test("barge-in cancels an active response", async () => {
    const emitted: ServerEvent[] = [];
    const orchestrator = new FakeOrchestrator();
    const pipeline = new ConversationPipeline("s1", (event) => emitted.push(event), orchestrator, 20);
    await pipeline.start();
    const response = pipeline.respond("long response");
    pipeline.interrupt();
    await response;

    expect(emitted.some((event) => event.type === "agent.text")).toBe(false);
    expect(orchestrator.events).toContain("interrupted");
  });
});
