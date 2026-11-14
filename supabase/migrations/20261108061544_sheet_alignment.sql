-- Add revision-bound project reference and sheet alignment; preserve existing authorization and CAS checks.
create or replace function private.save_revision(target_project uuid,expected_revision integer,changes jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 select coalesce(jsonb_object_agg(key,value),'{}') into changes from jsonb_each(changes) where key in ('intent','accepted_facts','geometry','notes','review_required_nodes','constraints','boundary_reviewed','setbacks','node_reviews','alignment');
 p:=p || changes || jsonb_build_object('current_revision',expected_revision+1,'updated_at',now());
 update public.projects set data=p where id=target_project;
 insert into public.project_records values(r,target_project,'revision',jsonb_build_object('id',r,'project_id',target_project,'revision',expected_revision+1,'snapshot',p,'author',auth.uid(),'created_at',now()),now());
 return p;
end $$;
revoke all on function private.save_revision(uuid,integer,jsonb) from public;
grant execute on function private.save_revision(uuid,integer,jsonb) to authenticated;
