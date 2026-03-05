create table public.tokens (
  id uuid not null default gen_random_uuid (),
  token_value text not null,
  duration_months integer not null,
  created_at timestamp with time zone null default now(),
  expiry_date timestamp with time zone not null,
  is_active boolean null default true,
  constraint tokens_pkey primary key (id),
  constraint tokens_token_value_key unique (token_value),
  constraint tokens_duration_months_check check ((duration_months = any (array[3, 6, 12]))),
  constraint valid_duration check ((duration_months = any (array[3, 6, 12])))
) TABLESPACE pg_default;

create index IF not exists idx_tokens_token_value on public.tokens using btree (token_value) TABLESPACE pg_default;

create index IF not exists idx_tokens_is_active on public.tokens using btree (is_active) TABLESPACE pg_default;