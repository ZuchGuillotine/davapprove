create function public.renew_processing_job(job_id uuid,attempt integer) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.project_records set data=data || jsonb_build_object('lease_until',extract(epoch from now())+1200)
 where id=job_id and kind='job' and data->>'status'='running' and (data->>'attempts')::integer=attempt;
 return found;
end $$;
revoke all on function public.renew_processing_job(uuid,integer) from public,anon,authenticated;
grant execute on function public.renew_processing_job(uuid,integer) to service_role;
