-- ONLY for a disposable, empty PostgreSQL test database, never a hosted project.
-- Minimal Supabase surfaces needed to exercise real Postgres grants and RLS.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
create schema storage;
create table storage.buckets (
 id text primary key, name text, public boolean,
 file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
 id uuid primary key default gen_random_uuid(), bucket_id text,
 name text not null, unique(bucket_id,name)
);
create function storage.foldername(name text) returns text[] language sql immutable as $$
 select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1]
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, service_role;
grant select,insert,update,delete on storage.objects to authenticated;
grant all on all tables in schema storage to service_role;
