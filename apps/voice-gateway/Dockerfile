FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY package.json bun.lock* tsconfig.json ./
COPY apps/voice-gateway apps/voice-gateway
COPY packages/contracts packages/contracts
COPY services/post-call-worker/package.json services/post-call-worker/package.json
RUN bun install --production
EXPOSE 3000
CMD ["bun", "apps/voice-gateway/src/index.ts"]

