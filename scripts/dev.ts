export {};

const processes = [
  Bun.spawn(["go", "run", "./cmd/server"], {
    cwd: "services/orchestrator",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, GOCACHE: "/tmp/voice-agent-go-cache" },
  }),
  Bun.spawn(["bun", "--watch", "apps/voice-gateway/src/index.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env },
  }),
];

console.log(`starting orchestrator :${process.env.ORCHESTRATOR_PORT ?? 8081} and gateway :${process.env.GATEWAY_PORT ?? 3000}`);

const shutdown = () => {
  for (const process of processes) process.kill();
  globalThis.process.exit(0);
};

globalThis.process.on("SIGINT", shutdown);
globalThis.process.on("SIGTERM", shutdown);
await Promise.all(processes.map((process) => process.exited));

