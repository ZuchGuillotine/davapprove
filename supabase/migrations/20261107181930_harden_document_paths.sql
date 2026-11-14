-- Canonical immutable paths prevent cross-project service-role fetches.
create or replace function private.save_record(record_kind text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
  if payload->>'storage_path' is distinct from p::text||'/'||(payload->>'id')::uuid::text||'.pdf' then raise exception 'invalid storage path';end if;
  payload:=jsonb_build_object('id',payload->>'id','project_id',p,'title',payload->>'title','storage_path',payload->>'storage_path','status','uploaded','created_at',now());
 else raise exception 'write not permitted';end if;
 insert into public.project_records(id,project_id,kind,data) values((payload->>'id')::uuid,p,record_kind,payload) on conflict(id) do nothing;
 select data into payload from public.project_records where id=(payload->>'id')::uuid and project_id=p and kind=record_kind;
 if payload is null then raise exception 'record conflict';end if;
 return payload;
end $$;
