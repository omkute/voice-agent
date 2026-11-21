import amqp, { type ConsumeMessage } from "amqplib";

const url = Bun.env.RABBITMQ_URL ?? "amqp://voice_agent:voice_agent@localhost:5672";
const queue = "voice-agent.post-call.v1";
const connection = await amqp.connect(url);
const channel = await connection.createChannel();

await channel.assertQueue(queue, { durable: true });
channel.prefetch(4);
console.log(`post-call worker consuming ${queue}`);

await channel.consume(queue, async (message: ConsumeMessage | null) => {
  if (!message) return;
  try {
    const job = JSON.parse(message.content.toString()) as { sessionId: string };
    console.log(JSON.stringify({
      event: "post_call.completed",
      sessionId: job.sessionId,
      tasks: ["summarize", "score", "persist_metrics"],
    }));
    channel.ack(message);
  } catch (error) {
    console.error("post-call job failed", error);
    channel.nack(message, false, false);
  }
});

const shutdown = async () => {
  await channel.close();
  await connection.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

