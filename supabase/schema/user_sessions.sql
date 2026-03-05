create table public.user_sessions (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  session_token text not null,
  created_at timestamp with time zone null default now(),
  expires_at timestamp with time zone not null,
  last_activity timestamp with time zone null default now(),
  is_active boolean null default true,
  user_agent text null,
  ip_address text null,
  constraint user_sessions_pkey primary key (id),
  constraint user_sessions_session_token_key unique (session_token),
  constraint user_sessions_user_id_fkey foreign KEY (user_id) references users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_user_sessions_user_id on public.user_sessions using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_user_sessions_token on public.user_sessions using btree (session_token) TABLESPACE pg_default;

create index IF not exists idx_user_sessions_active on public.user_sessions using btree (is_active) TABLESPACE pg_default;

create index IF not exists idx_user_sessions_created_at on public.user_sessions using btree (created_at) TABLESPACE pg_default;