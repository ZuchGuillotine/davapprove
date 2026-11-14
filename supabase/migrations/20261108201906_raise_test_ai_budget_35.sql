-- Authorized shared monthly test-project cap: $35; retain existing usage and grants.
create or replace function public.reserve_ai_budget(job_key text,month text,amount_microusd bigint,limit_microusd bigint) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtext('davapprove-ai-budget'));
 if job_key is null or month is null or amount_microusd is null or limit_microusd is null or amount_microusd<0 or limit_microusd<0 or limit_microusd>35000000 or amount_microusd>limit_microusd then return false;end if;
 if exists(select 1 from private.ai_usage u where u.job_key=reserve_ai_budget.job_key) then return false;end if;
 if (select coalesce(sum(u.amount_microusd),0) from private.ai_usage u where u.month=reserve_ai_budget.month)+amount_microusd>limit_microusd then return false;end if;
 insert into private.ai_usage values(job_key,month,amount_microusd);return true;
end $$;
revoke all on function public.reserve_ai_budget(text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.reserve_ai_budget(text,text,bigint,bigint) to service_role;
