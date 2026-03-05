create table public.imprisonment_metrics (
  id serial not null,
  user_id uuid not null,
  connection_number integer not null,
  timestamp_ms integer not null,
  player_name character varying(255) not null,
  code_used character varying(10) not null,
  is_clan_member boolean not null default false,
  created_at timestamp with time zone null default now(),
  is_success boolean not null default true,
  timing_value integer null,
  timing_type character varying(10) null,
  ping_ms integer null,
  context character varying(20) null,
  is_defense boolean not null default false,
  adjustment_reason character varying(20) null,
  constraint imprisonment_metrics_pkey primary key (id),
  constraint imprisonment_metrics_adjustment_reason_check check (
    (
      (adjustment_reason is null)
      or (
        (adjustment_reason)::text = any (
          (
            array[
              'SUCCESS'::character varying,
              '3S_ERROR'::character varying,
              'LEFT_EARLY'::character varying,
              'KICKED'::character varying
            ]
          )::text[]
        )
      )
    )
  ),
  constraint imprisonment_metrics_code_used_check check (
    (
      (code_used)::text = any (
        (
          array[
            'primary'::character varying,
            'alt'::character varying
          ]
        )::text[]
      )
    )
  ),
  constraint imprisonment_metrics_connection_number_check check (
    (
      (connection_number >= 1)
      and (connection_number <= 5)
    )
  ),
  constraint imprisonment_metrics_context_check check (
    (
      (context is null)
      or (
        (context)::text = any (
          (
            array[
              'FAST'::character varying,
              'NORMAL'::character varying,
              'SLOW'::character varying
            ]
          )::text[]
        )
      )
    )
  ),
  constraint imprisonment_metrics_timing_type_check check (
    (
      (timing_type)::text = any (
        (
          array[
            'attack'::character varying,
            'defense'::character varying
          ]
        )::text[]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_imprisonment_user_conn on public.imprisonment_metrics using btree (user_id, connection_number) TABLESPACE pg_default;

create index IF not exists idx_imprisonment_created_at on public.imprisonment_metrics using btree (created_at) TABLESPACE pg_default;

create index IF not exists idx_imprisonment_is_success on public.imprisonment_metrics using btree (is_success) TABLESPACE pg_default;

create index IF not exists idx_imprisonment_timing on public.imprisonment_metrics using btree (user_id, connection_number, created_at desc) TABLESPACE pg_default;

create index IF not exists idx_ai_personal_history on public.imprisonment_metrics using btree (
  user_id,
  connection_number,
  timing_type,
  is_success,
  created_at desc
) TABLESPACE pg_default;

create index IF not exists idx_ai_transfer_learning on public.imprisonment_metrics using btree (timing_type, is_success, created_at desc) TABLESPACE pg_default;

create index IF not exists idx_ai_context_lookup on public.imprisonment_metrics using btree (user_id, connection_number, context, timing_type) TABLESPACE pg_default;

create index IF not exists idx_imprisonment_metrics_defense on public.imprisonment_metrics using btree (user_id, is_defense, context, ping_ms) TABLESPACE pg_default
where
  (is_defense = true);

create index IF not exists idx_imprisonment_adjustment_reason on public.imprisonment_metrics using btree (
  user_id,
  connection_number,
  adjustment_reason,
  created_at desc
) TABLESPACE pg_default;