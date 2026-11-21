import type { Orchestrator } from "./pipeline.ts";

export class HttpOrchestrator implements Orchestrator {
  constructor(private readonly baseUrl: string) {}

  async open(sessionId: string) {
    await this.request(`/v1/sessions/${sessionId}`, { method: "POST" });
  }

  async event(sessionId: string, kind: string, payload: Record<string, string> = {}) {
    await this.request(`/v1/sessions/${sessionId}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: crypto.randomUUID(), kind, ...payload }),
    });
  }

  private async request(path: string, init: RequestInit) {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw new Error(`orchestrator returned ${response.status}: ${await response.text()}`);
    }
  }
}

