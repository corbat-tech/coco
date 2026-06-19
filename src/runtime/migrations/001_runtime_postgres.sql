create table if not exists coco_runtime_sessions (
  id text primary key,
  tenant_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  mode text not null,
  messages jsonb not null default '[]'::jsonb,
  instructions text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists coco_runtime_sessions_tenant_updated_idx
  on coco_runtime_sessions (tenant_id, updated_at desc);

create table if not exists coco_runtime_events (
  id text primary key,
  tenant_id text,
  type text not null,
  timestamp timestamptz not null,
  data jsonb not null default '{}'::jsonb
);

create index if not exists coco_runtime_events_tenant_timestamp_idx
  on coco_runtime_events (tenant_id, timestamp asc);

create index if not exists coco_runtime_events_session_idx
  on coco_runtime_events ((data->>'sessionId'), timestamp asc);
