-- A display-name change does not create a design revision.
create function private.rename_project(target_project uuid, project_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb;
begin
 if auth.uid() is null or coalesce(private.project_role(target_project),'') not in ('owner','editor') then
  raise exception 'unauthorized';
 end if;
 if project_name is null or length(btrim(project_name)) not between 1 and 160 then
  raise exception 'invalid project name';
 end if;
 update public.projects
 set data=data || jsonb_build_object('name',btrim(project_name),'updated_at',now())
 where id=target_project returning data into p;
 return p;
end $$;
revoke all on function private.rename_project(uuid,text) from public;
grant execute on function private.rename_project(uuid,text) to authenticated;
create function public.rename_project(target_project uuid, project_name text)
returns jsonb language sql security invoker set search_path='' as $$
 select private.rename_project(target_project,project_name)
$$;
revoke all on function public.rename_project(uuid,text) from public;
grant execute on function public.rename_project(uuid,text) to authenticated;
