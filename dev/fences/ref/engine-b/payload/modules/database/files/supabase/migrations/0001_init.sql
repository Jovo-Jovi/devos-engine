-- Forward-only migration. Never edit an applied migration; add a new file.
-- Every schema change waits for a human merge (devos:human-gate).
create table if not exists app_meta (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
