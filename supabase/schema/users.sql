create table public.users (
  id uuid not null default gen_random_uuid (),
  username text not null,
  password_hash text not null,
  token_id uuid null,
  subscription_months integer null,
  token_expiry_date timestamp with time zone null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  last_login timestamp with time zone null,
  is_active boolean null default true,
  constraint users_pkey primary key (id),
  constraint users_username_key unique (username),
  constraint users_token_id_fkey foreign KEY (token_id) references tokens (id) on delete set null,
  constraint username_format check (
    (
      username ~ '^([a-zA-Z0-9_-]+|DELETED_[a-zA-Z0-9_-]+_[0-9]+)$'::text
    )
  ),
  constraint username_length check (
    (
      (char_length(username) >= 3)
      and (char_length(username) <= 200)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_users_username on public.users using btree (username) TABLESPACE pg_default;

create index IF not exists idx_users_token_id on public.users using btree (token_id) TABLESPACE pg_default;

create index IF not exists idx_users_is_active on public.users using btree (is_active) TABLESPACE pg_default;

create trigger update_users_updated_at BEFORE
update on users for EACH row
execute FUNCTION update_updated_at_column ();