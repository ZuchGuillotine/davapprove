-- Davapprove MVP. Source and typed domain fields live in versioned JSON documents;
-- relational project boundaries and foreign keys enforce tenant isolation.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
create table public.projects (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 data jsonb not null, created_at timestamptz not null default now(),
 check (data->>'id'=id::text), check (data->>'owner_id'=owner_id::text)
);
create table public.project_memberships (
 project_id uuid not null references public.projects(id) on delete cascade,
 user_id uuid not null references auth.users(id), role text not null check(role in ('editor','reviewer')),
 primary key(project_id,user_id)
);
create table public.project_records (
 id uuid primary key, project_id uuid not null references public.projects(id) on delete cascade,
 kind text not null check(kind in ('candidate','coverage','job','document','fact','revision','comment','event')),
 data jsonb not null, created_at timestamptz not null default now(),
 check(data->>'id'=id::text),check(data->>'project_id'=project_id::text)
);
create index records_project_kind on public.project_records(project_id,kind);
create index memberships_user on public.project_memberships(user_id);
create index projects_owner on public.projects(owner_id);
create index queued_jobs on public.project_records((data->>'status')) where kind='job';
alter table public.projects enable row level security;
alter table public.project_memberships enable row level security;
alter table public.project_records enable row level security;
revoke all on public.projects, public.project_memberships, public.project_records from anon, authenticated;
grant select on public.projects to authenticated;
grant select,insert,update,delete on public.project_memberships to authenticated;
grant select,insert,update on public.project_records to authenticated;
grant all on public.projects, public.project_memberships, public.project_records to service_role;

create function private.project_role(target uuid) returns text language sql stable security definer set search_path='' as $$
 select case when p.owner_id=auth.uid() then 'owner' else
 (select m.role from public.project_memberships m where m.project_id=p.id and m.user_id=auth.uid()) end
 from public.projects p where p.id=target and auth.uid() is not null
$$;
revoke all on function private.project_role(uuid) from public;
grant execute on function private.project_role(uuid) to authenticated;
create policy project_read on public.projects for select to authenticated using(private.project_role(id) is not null);
create policy member_read on public.project_memberships for select to authenticated using(private.project_role(project_id) is not null);
create policy member_insert on public.project_memberships for insert to authenticated with check(private.project_role(project_id)='owner');
create policy member_update on public.project_memberships for update to authenticated using(private.project_role(project_id)='owner') with check(private.project_role(project_id)='owner');
create policy member_delete on public.project_memberships for delete to authenticated using(private.project_role(project_id)='owner');
create policy record_read on public.project_records for select to authenticated using(private.project_role(project_id) is not null);
create policy record_insert on public.project_records for insert to authenticated with check(
 (private.project_role(project_id) in ('owner','editor') and kind not in ('revision','event')) or
 (private.project_role(project_id)='reviewer' and kind='comment'));
create policy record_update on public.project_records for update to authenticated using(private.project_role(project_id) in ('owner','editor') and kind not in ('revision','event')) with check(private.project_role(project_id) in ('owner','editor') and kind not in ('revision','event'));

create function private.create_project(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or payload->>'owner_id' is distinct from auth.uid()::text then raise exception 'unauthorized';end if;
 payload:=jsonb_build_object('id',payload->>'id','owner_id',auth.uid(),'name',payload->>'name','parcel_number',payload->>'parcel_number','parcel',jsonb_build_object('parcel_number',payload->>'parcel_number'),'jurisdiction','unknown','source_verified',false,'intent',payload->'intent','current_revision',1,'accepted_facts','{}'::jsonb,'created_at',now());
 if (select count(*) from public.projects)>=20 then raise exception 'Pilot project quota reached';end if;
 insert into public.projects(id,owner_id,data) values((payload->>'id')::uuid,auth.uid(),payload);
 insert into public.project_records(id,project_id,kind,data)
 select x,(payload->>'id')::uuid,'revision',jsonb_build_object('id',x,'project_id',payload->>'id','revision',1,'snapshot',payload,'created_at',now()) from (select gen_random_uuid() x) s;
 return payload;
end $$;
revoke all on function private.create_project(jsonb) from public;
grant execute on function private.create_project(jsonb) to authenticated;
create function public.create_project(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.create_project(payload) $$;
revoke all on function public.create_project(jsonb) from public;
grant execute on function public.create_project(jsonb) to authenticated;

create function private.save_revision(target_project uuid,expected_revision integer,changes jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb; r uuid:=gen_random_uuid(); f record;
begin
 if auth.uid() is null or coalesce(private.project_role(target_project),'') not in ('owner','editor') then raise exception 'unauthorized';end if;
 select data into p from public.projects where id=target_project for update;
 if expected_revision is null or (p->>'current_revision')::integer<>expected_revision then raise exception 'revision_conflict';end if;
 if jsonb_typeof(changes->'accepted_facts')='object' then
  for f in select key,value from jsonb_each(changes->'accepted_facts') loop
   if not exists(select 1 from public.project_records where id=f.key::uuid and project_id=target_project and kind='fact') or coalesce(f.value->>'review_status','') not in ('accepted','rejected') then raise exception 'invalid fact';end if;
  end loop;
 end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into changes from jsonb_each(changes) where key in ('intent','accepted_facts','geometry','notes','review_required_nodes','constraints','boundary_reviewed','setbacks','node_reviews');
 p:=p || changes || jsonb_build_object('current_revision',expected_revision+1,'updated_at',now());
 update public.projects set data=p where id=target_project;
 insert into public.project_records values(r,target_project,'revision',jsonb_build_object('id',r,'project_id',target_project,'revision',expected_revision+1,'snapshot',p,'author',auth.uid(),'created_at',now()),now());
 return p;
end $$;
revoke all on function private.save_revision(uuid,integer,jsonb) from public;
grant execute on function private.save_revision(uuid,integer,jsonb) to authenticated;
create function public.save_revision(target_project uuid,expected_revision integer,changes jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.save_revision(target_project,expected_revision,changes) $$;
revoke all on function public.save_revision(uuid,integer,jsonb) from public;
grant execute on function public.save_revision(uuid,integer,jsonb) to authenticated;

create function public.claim_job() returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; rec public.project_records;
begin
 select * into rec from public.project_records where kind='job' and
 ((data->>'status'='queued' and coalesce((data->>'run_after')::float,0)<=extract(epoch from now())) or
 (data->>'status'='running' and coalesce((data->>'lease_until')::float,0)<extract(epoch from now())))
 and coalesce((data->>'attempts')::integer,0)<3 order by created_at for update skip locked limit 1;
 if rec.id is null then return null;end if;
 result:=rec.data||jsonb_build_object('status','running','attempts',coalesce((rec.data->>'attempts')::integer,0)+1,'lease_until',extract(epoch from now())+1200,'updated_at',now());
 update public.project_records set data=result where id=rec.id;
 return result;
end $$;
revoke all on function public.claim_job() from public,anon,authenticated;
grant execute on function public.claim_job() to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('project-documents','project-documents',false,262144000,array['application/pdf']) on conflict(id) do nothing;
create policy document_read on storage.objects for select to authenticated using(bucket_id='project-documents' and private.project_role((storage.foldername(name))[1]::uuid) is not null);
create policy document_insert on storage.objects for insert to authenticated with check(bucket_id='project-documents' and private.project_role((storage.foldername(name))[1]::uuid) in ('owner','editor'));
-- No UPDATE/upsert policy: originals are immutable. No anonymous download policy.
-- Clients cannot forge extraction outputs, source candidates or completed jobs.
revoke insert,update on public.project_records from authenticated;
create function private.save_record(record_kind text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare role_name text; p uuid; candidate jsonb;
begin
 if auth.uid() is null then raise exception 'unauthorized';end if;
 p:=(payload->>'project_id')::uuid; role_name:=private.project_role(p);
 if role_name is null then raise exception 'unauthorized';end if;
 if record_kind='comment' then
  if coalesce(length(payload->>'body'),0) not between 1 and 10000 then raise exception 'invalid comment';end if;
  if payload->>'document_id' is not null and not exists(select 1 from public.project_records where id=(payload->>'document_id')::uuid and project_id=p and kind='document') then raise exception 'invalid document';end if;
  payload:=jsonb_build_object('id',payload->>'id','project_id',p,'body',payload->>'body','author',auth.uid(),'revision',payload->'revision','node_id',payload->'node_id','document_id',payload->'document_id','created_at',now());
 elsif role_name in ('owner','editor') and record_kind='job' then
  if coalesce(payload->>'type','') not in ('discover','import','parse') then raise exception 'invalid job';end if;
  if payload->>'type'='import' then
   select data into candidate from public.project_records where id=(payload->>'candidate_id')::uuid and project_id=p and kind='candidate';
   if candidate is null then raise exception 'invalid candidate';end if;
  end if;
  if payload->>'type'='parse' and not exists(select 1 from public.project_records where id=(payload->>'document_id')::uuid and project_id=p and kind='document') then raise exception 'invalid document';end if;
  payload:=jsonb_build_object('id',payload->>'id','project_id',p,'type',payload->>'type','candidate_id',payload->'candidate_id','document_id',payload->'document_id','idempotency_key',payload->'idempotency_key','status','queued','attempts',0,'created_at',now());
 elsif role_name in ('owner','editor') and record_kind='document' then
  if split_part(payload->>'storage_path','/',1) is distinct from p::text then raise exception 'invalid storage path';end if;
  payload:=jsonb_build_object('id',payload->>'id','project_id',p,'title',payload->>'title','storage_path',payload->>'storage_path','status','uploaded','created_at',now());
 else raise exception 'write not permitted';end if;
 insert into public.project_records(id,project_id,kind,data) values((payload->>'id')::uuid,p,record_kind,payload) on conflict(id) do nothing;
 select data into payload from public.project_records where id=(payload->>'id')::uuid and project_id=p and kind=record_kind;
 if payload is null then raise exception 'record conflict';end if;
 return payload;
end $$;
revoke all on function private.save_record(text,jsonb) from public;
grant execute on function private.save_record(text,jsonb) to authenticated;
create function public.save_record(record_kind text,payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.save_record(record_kind,payload)$$;
revoke all on function public.save_record(text,jsonb) from public;
grant execute on function public.save_record(text,jsonb) to authenticated;
-- Worker-only atomic AI spending reservations. Failed/uncertain calls retain reservation.
create table private.ai_usage (job_key text primary key, month text not null, amount_microusd bigint not null check(amount_microusd>=0));
revoke all on private.ai_usage from public,anon,authenticated;
grant select,insert,update on private.ai_usage to service_role;
create function public.reserve_ai_budget(job_key text,month text,amount_microusd bigint,limit_microusd bigint) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtext('davapprove-ai-budget'));
 if amount_microusd<0 or limit_microusd>5000000 or amount_microusd>limit_microusd then return false;end if;
 if exists(select 1 from private.ai_usage u where u.job_key=reserve_ai_budget.job_key) then return false;end if;
 if (select coalesce(sum(u.amount_microusd),0) from private.ai_usage u where u.month=reserve_ai_budget.month)+amount_microusd>limit_microusd then return false;end if;
 insert into private.ai_usage values(job_key,month,amount_microusd);return true;
end $$;
revoke all on function public.reserve_ai_budget(text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.reserve_ai_budget(text,text,bigint,bigint) to service_role;
create function public.reconcile_ai_budget(job_key text,actual_microusd bigint) returns void language sql security invoker set search_path='' as $$
 update private.ai_usage set amount_microusd=greatest(0,least(amount_microusd,actual_microusd)) where ai_usage.job_key=reconcile_ai_budget.job_key
$$;
revoke all on function public.reconcile_ai_budget(text,bigint) from public,anon,authenticated;
grant execute on function public.reconcile_ai_budget(text,bigint) to service_role;
create function private.cancel_job(job_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.project_records;
begin
 select * into j from public.project_records where id=job_id and kind='job' for update;
 if j.id is null or auth.uid() is null or coalesce(private.project_role(j.project_id),'') not in ('owner','editor') then raise exception 'unauthorized';end if;
 if j.data->>'status' in ('queued','running') then
  j.data:=j.data||jsonb_build_object('status','cancelled','updated_at',now());
  update public.project_records set data=j.data where id=job_id;
 end if;return j.data;
end $$;
revoke all on function private.cancel_job(uuid) from public;
grant execute on function private.cancel_job(uuid) to authenticated;
create function public.cancel_job(job_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.cancel_job(job_id)$$;
revoke all on function public.cancel_job(uuid) from public;
grant execute on function public.cancel_job(uuid) to authenticated;
create function public.hydrate_project(target_project uuid,parcel jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p jsonb;
begin
 select data into p from public.projects where id=target_project for update;
 if p is null then raise exception 'missing project';end if;
 p:=p||jsonb_build_object('parcel',parcel,'jurisdiction',coalesce(parcel->>'jurisdiction','unknown'),'source_verified',true);
 update public.projects set data=p where id=target_project;return p;
end $$;
revoke all on function public.hydrate_project(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.hydrate_project(uuid,jsonb) to service_role;
