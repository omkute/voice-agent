CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS conversation_turns (
  id UUID PRIMARY KEY,
  call_id UUID NOT NULL REFERENCES calls(id),
  ordinal INTEGER NOT NULL,
  speaker TEXT NOT NULL CHECK (speaker IN ('user', 'agent', 'tool')),
  transcript TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  latency_ms INTEGER,
  UNIQUE (call_id, ordinal)
);

CREATE TABLE IF NOT EXISTS call_metrics (
  call_id UUID PRIMARY KEY REFERENCES calls(id),
  first_token_p50_ms INTEGER,
  first_token_p95_ms INTEGER,
  interruption_count INTEGER NOT NULL DEFAULT 0,
  audio_dropped_frames INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

