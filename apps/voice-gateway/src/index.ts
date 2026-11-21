import type { ClientEvent, ServerEvent } from "../../../packages/contracts/src/events.ts";
import { HttpOrchestrator } from "./orchestrator.ts";
import { ConversationPipeline } from "./pipeline.ts";
import page from "../public/index.html";

type Connection = {
  id: string;
  audioBytes: number;
  pipeline?: ConversationPipeline;
};

const port = Number(Bun.env.GATEWAY_PORT ?? 3000);
const orchestratorUrl = Bun.env.ORCHESTRATOR_URL ?? "http://localhost:8081";
const orchestrator = new HttpOrchestrator(orchestratorUrl);

const server = Bun.serve<Connection>({
  port,
  routes: {
    "/": page,
    "/healthz": Response.json({ status: "ok" }),
  },
  fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });

    const id = crypto.randomUUID();
    const upgraded = server.upgrade(request, { data: { id, audioBytes: 0 } });
    return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
  },
  websocket: {
    open(socket) {
      const pipeline = new ConversationPipeline(socket.data.id, (event: ServerEvent) => {
        socket.send(JSON.stringify(event));
      }, orchestrator);
      socket.data.pipeline = pipeline;
      socket.send(JSON.stringify({ type: "session.ready", sessionId: socket.data.id, phase: "idle" } satisfies ServerEvent));
      pipeline.start().catch((error) => sendError(socket, error));
    },
    message(socket, message) {
      if (typeof message !== "string") {
        socket.data.audioBytes += message.byteLength;
        if (socket.data.audioBytes % 16_000 < message.byteLength) {
          socket.send(JSON.stringify({ type: "transcript.partial", text: "Receiving live microphone audio…" } satisfies ServerEvent));
        }
        return;
      }

      try {
        const event = JSON.parse(message) as ClientEvent;
        const pipeline = socket.data.pipeline;
        if (!pipeline) throw new Error("session is not ready");
        switch (event.type) {
          case "input.audio.start":
            socket.data.audioBytes = 0;
            pipeline.interrupt();
            break;
          case "input.audio.commit": {
            const seconds = Math.max(1, Math.round(socket.data.audioBytes / 16_000));
            void pipeline.respond(`Demo microphone utterance (${seconds}s of streamed audio)`).catch((error) => sendError(socket, error));
            break;
          }
          case "input.text":
            void pipeline.respond(event.text).catch((error) => sendError(socket, error));
            break;
          case "input.interrupt":
            pipeline.interrupt();
            break;
          case "session.end":
            void pipeline.end().finally(() => socket.close());
            break;
          case "session.start":
            break;
        }
      } catch (error) {
        sendError(socket, error);
      }
    },
    close(socket) {
      void socket.data.pipeline?.end().catch(() => undefined);
    },
  },
});

console.log(`voice gateway listening on http://localhost:${server.port}`);

function sendError(socket: { send(data: string): unknown }, error: unknown) {
  socket.send(JSON.stringify({
    type: "error",
    code: "pipeline_error",
    message: error instanceof Error ? error.message : "Unknown pipeline error",
  } satisfies ServerEvent));
}

