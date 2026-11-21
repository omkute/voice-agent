.PHONY: dev test check infra-up infra-down

dev:
	bun run dev

test:
	bun run test

check:
	bun run check

infra-up:
	docker compose up -d postgres redis rabbitmq livekit

infra-down:
	docker compose down

