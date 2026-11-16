-- Account-backed bids: no implicit claims of browser-local drafts.
create table public.bids (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 data jsonb not null, version integer not null default 1 check(version>0),
 updated_at timestamptz not null default now(),
 check(data->>'id'=id::text), check(jsonb_typeof(data)='object'),
 check(octet_length(data::text)<=5242880)
);
create table public.bid_memberships (
 bid_id uuid not null references public.bids(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 role text not null check(role in ('editor','reviewer')),
 primary key(bid_id,user_id)
);
create index bid_owner on public.bids(owner_id);
create index bid_member_user on public.bid_memberships(user_id);
alter table public.bids enable row level security;
alter table public.bid_memberships enable row level security;
revoke all on public.bids, public.bid_memberships from public, anon, authenticated;
grant select on public.bids, public.bid_memberships to authenticated;
grant all on public.bids, public.bid_memberships to service_role;
create function private.bid_role(target uuid) returns text language sql stable security definer set search_path='' as $$
 select case when b.owner_id=auth.uid() then 'owner' else
 (select m.role from public.bid_memberships m where m.bid_id=b.id and m.user_id=auth.uid()) end
 from public.bids b where b.id=target and auth.uid() is not null
$$;
revoke all on function private.bid_role(uuid) from public;
grant execute on function private.bid_role(uuid) to authenticated;
create policy bid_read on public.bids for select to authenticated using(private.bid_role(id) is not null);
create policy bid_member_read on public.bid_memberships for select to authenticated using(private.bid_role(bid_id) is not null);
create function private.save_bid(payload jsonb, expected_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=(payload->>'id')::uuid; saved public.bids;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if payload->>'version' is distinct from '1' or jsonb_typeof(payload->'parcel') is distinct from 'object' or jsonb_typeof(payload->'screening') is distinct from 'object' or jsonb_typeof(payload->'project') is distinct from 'object' then raise exception 'Invalid bid'; end if;
 if expected_version=0 then
   insert into public.bids(id,owner_id,data) values(target,auth.uid(),payload) returning * into saved;
 else
   if coalesce(private.bid_role(target),'') not in ('owner','editor') then raise exception 'Editor access required'; end if;
   update public.bids set data=payload,version=version+1,updated_at=now() where id=target and version=expected_version returning * into saved;
   if not found then raise exception 'This bid changed elsewhere. Reopen it before saving.'; end if;
 end if;
 return to_jsonb(saved);
end $$;
revoke all on function private.save_bid(jsonb,integer) from public;
grant execute on function private.save_bid(jsonb,integer) to authenticated;
create function public.save_bid(payload jsonb, expected_version integer) returns jsonb language sql security invoker set search_path='' as $$ select private.save_bid(payload,expected_version) $$;
revoke all on function public.save_bid(jsonb,integer) from public;
grant execute on function public.save_bid(jsonb,integer) to authenticated;
-- Explicit owner-controlled sharing with existing confirmed accounts. No emails sent.
create function private.share_workspace(workspace_kind text, target uuid, collaborator_email text, access_role text) returns void language plpgsql security definer set search_path='' as $$
declare collaborator uuid; owner uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if workspace_kind='bid' then select owner_id into owner from public.bids where id=target;
 elsif workspace_kind='project' then select owner_id into owner from public.projects where id=target;
 else raise exception 'Invalid workspace'; end if;
 if owner is distinct from auth.uid() then raise exception 'Only the creator can manage collaborators'; end if;
 if access_role not in ('editor','reviewer','remove') or access_role is null then raise exception 'Invalid access'; end if;
 select id into collaborator from auth.users where lower(email)=lower(btrim(collaborator_email)) and email_confirmed_at is not null;
 if collaborator is null then raise exception 'Ask this collaborator to create and confirm an account first.'; end if;
 if collaborator=owner then raise exception 'Creator access cannot be changed'; end if;
 if workspace_kind='bid' then
   if access_role='remove' then delete from public.bid_memberships where bid_id=target and user_id=collaborator;
   else insert into public.bid_memberships values(target,collaborator,access_role) on conflict(bid_id,user_id) do update set role=excluded.role; end if;
 else
   if access_role='remove' then delete from public.project_memberships where project_id=target and user_id=collaborator;
   else insert into public.project_memberships values(target,collaborator,access_role) on conflict(project_id,user_id) do update set role=excluded.role; end if;
 end if;
end $$;
revoke all on function private.share_workspace(text,uuid,text,text) from public;
grant execute on function private.share_workspace(text,uuid,text,text) to authenticated;
create function public.share_workspace(workspace_kind text, target uuid, collaborator_email text, access_role text) returns void language sql security invoker set search_path='' as $$ select private.share_workspace(workspace_kind,target,collaborator_email,access_role) $$;
revoke all on function public.share_workspace(text,uuid,text,text) from public;
grant execute on function public.share_workspace(text,uuid,text,text) to authenticated;
