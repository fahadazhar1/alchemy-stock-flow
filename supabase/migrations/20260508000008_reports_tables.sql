-- saved_reports: user-created and template-based reports
create table if not exists saved_reports (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  template_name text,
  owner_name    text        not null default 'You',
  config        jsonb       not null default '{}',
  store_id      uuid        references stores(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- report_schedules: scheduled delivery configuration
create table if not exists report_schedules (
  id               uuid        primary key default gen_random_uuid(),
  saved_report_id  uuid        references saved_reports(id) on delete set null,
  name             text        not null,
  recipients       text[]      not null default '{}',
  frequency_label  text        not null,
  next_run_at      timestamptz,
  is_active        boolean     not null default true,
  formats          text[]      not null default '{PDF}',
  store_id         uuid        references stores(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table saved_reports   enable row level security;
alter table report_schedules enable row level security;

create policy "saved_reports_all"    on saved_reports    using (true) with check (true);
create policy "report_schedules_all" on report_schedules using (true) with check (true);
