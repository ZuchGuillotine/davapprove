-- Run only after bootstrap + migration in a disposable test database.
\set ON_ERROR_STOP on
begin;
insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.create_project('{"id":"10000000-0000-4000-8000-000000000001","owner_id":"00000000-0000-4000-8000-000000000001","current_revision":1,"name":"A","jurisdiction":"kitsap_county"}');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.create_project('{"id":"10000000-0000-4000-8000-000000000002","owner_id":"00000000-0000-4000-8000-000000000002","current_revision":1,"name":"B","jurisdiction":"poulsbo"}');
do $$ begin
 if (select count(*) from public.projects)<>1 then raise exception 'RLS leaked a project';end if;
 if (select count(*) from public.project_records)<>1 then raise exception 'RLS leaked revisions';end if;
 begin
  perform public.save_revision('10000000-0000-4000-8000-000000000001',1,'{}');
  raise exception 'Cross-project revision permitted';
 exception when raise_exception then if sqlerrm<>'unauthorized' then raise;end if;end;
 begin
  perform public.create_project('{"id":"10000000-0000-4000-8000-000000000003","current_revision":1}');
  raise exception 'Missing owner accepted';
 exception when raise_exception then if sqlerrm<>'unauthorized' then raise;end if;end;
 begin
  insert into public.project_records values(gen_random_uuid(),'10000000-0000-4000-8000-000000000002','fact','{}',now());
  raise exception 'Forged extraction accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.claim_job();raise exception 'Client claimed worker job';
 exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$begin
 begin
  perform public.save_record('document','{"id":"30000000-0000-4000-8000-000000000001","project_id":"10000000-0000-4000-8000-000000000001","storage_path":"10000000-0000-4000-8000-000000000001/../10000000-0000-4000-8000-000000000002/private.pdf"}');
  raise exception 'Traversal path accepted';
 exception when raise_exception then if sqlerrm<>'invalid storage path' then raise;end if;end;
end$$;
insert into public.project_memberships values('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','reviewer');
insert into storage.objects(bucket_id,name) values('project-documents','10000000-0000-4000-8000-000000000001/original.pdf');
select public.save_revision('10000000-0000-4000-8000-000000000001',1,'{"intent":{"bedrooms":4}}');
do $$begin
 begin
  perform public.save_revision('10000000-0000-4000-8000-000000000001',1,'{}');raise exception 'Stale revision accepted';
 exception when raise_exception then if sqlerrm<>'revision_conflict' then raise;end if;end;
 if (select count(*) from public.project_records where kind='revision')<>2 then raise exception 'History not preserved';end if;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.save_record('comment','{"id":"20000000-0000-4000-8000-000000000001","project_id":"10000000-0000-4000-8000-000000000001","body":"Please review","revision":2}');
do $$begin
 if (select count(*) from storage.objects)<>1 then raise exception 'Reviewer cannot see shared file';end if;
 begin
  perform public.save_revision('10000000-0000-4000-8000-000000000001',2,'{}');raise exception 'Reviewer edited project';
 exception when raise_exception then if sqlerrm<>'unauthorized' then raise;end if;end;
 begin
  perform public.save_record('job','{"id":"20000000-0000-4000-8000-000000000002","project_id":"10000000-0000-4000-8000-000000000001","type":"discover"}');raise exception 'Reviewer enqueued job';
 exception when raise_exception then if sqlerrm<>'write not permitted' then raise;end if;end;
 begin
  insert into storage.objects(bucket_id,name) values('project-documents','10000000-0000-4000-8000-000000000001/new.pdf');raise exception 'Reviewer uploaded';
 exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$begin
 if (select count(*) from storage.objects)<>0 then raise exception 'Cross-project storage leaked';end if;
end$$;
rollback;
\echo 'PASS real PostgreSQL RLS: project isolation, history, worker boundaries, reviewer permissions, private storage'
