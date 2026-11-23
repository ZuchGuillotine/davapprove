create table public.beta_events (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    state text not null check (state ~ '^[A-Z]{2}$'),
    county text not null check (char_length(county) between 1 and 80),
    supported boolean not null,
    source text check (source in ('web', 'mcp')),
    project_type text check (project_type in ('new_sfr', 'adu', 'addition', 'accessory', 'rebuild', 'shoreline_structure', 'short_plat', 'clearing')),
    upgrades text[] check (array_position(upgrades, null) is null and upgrades <@ array[
        'solar', 'battery', 'ev_charger', 'electrical_service', 'heat_pump', 'water_heater',
        'plumbing', 'roof', 'windows', 'deck', 'retaining_wall', 'fence'
    ]::text[]),
    coverage text check (coverage in ('complete', 'partial', 'unavailable')),
    constraint beta_events_location_only_when_unsupported check (
        (supported and source is not null and project_type is not null and upgrades is not null and coverage is not null)
        or (not supported and source is null and project_type is null and upgrades is null and coverage is null)
    )
);

alter table public.beta_events enable row level security;
revoke all on public.beta_events from public, anon, authenticated, service_role;
grant insert on public.beta_events to service_role;

-- Preserve access for the existing project design partners.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"davapprove_beta":true}'::jsonb
where email_confirmed_at is not null
  and id in (select user_id from public.project_memberships);
