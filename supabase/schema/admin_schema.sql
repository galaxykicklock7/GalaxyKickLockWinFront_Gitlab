create table public.admins (
  id uuid not null default gen_random_uuid (),
  username text not null,
  password_hash text not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  last_login timestamp with time zone null,
  is_active boolean null default true,
  constraint admins_pkey primary key (id),
  constraint admins_username_key unique (username),
  constraint admin_username_format check ((username ~ '^[a-zA-Z0-9_-]+$'::text)),
  constraint admin_username_length check (
    (
      (char_length(username) >= 3)
      and (char_length(username) <= 50)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_admins_username on public.admins using btree (username) TABLESPACE pg_default;

create trigger update_admins_updated_at BEFORE
update on admins for EACH row
execute FUNCTION update_updated_at_column ();