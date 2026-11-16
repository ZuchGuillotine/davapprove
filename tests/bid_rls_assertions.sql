-- Transactional tests on the disposable database, never retained.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000011','creator@example.test',now()),
 ('00000000-0000-4000-8000-000000000012','editor@example.test',now()),
 ('00000000-0000-4000-8000-000000000013','outsider@example.test',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
select public.save_bid('{"id":"10000000-0000-4000-8000-000000000011","version":1,"parcel":{},"screening":{},"project":{},"title":"Private"}',0);
select public.share_workspace('bid','10000000-0000-4000-8000-000000000011','editor@example.test','editor');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',true);
do $$ begin
 if (select count(*) from public.bids)<>1 then raise exception 'Shared bid invisible'; end if;
 perform public.save_bid('{"id":"10000000-0000-4000-8000-000000000011","version":1,"parcel":{},"screening":{},"project":{},"title":"Edited"}',1);
 begin perform public.save_bid('{"id":"10000000-0000-4000-8000-000000000011","version":1,"parcel":{},"screening":{},"project":{}}',1); raise exception 'Stale overwrite accepted';
 exception when raise_exception then if sqlerrm<>'This bid changed elsewhere. Reopen it before saving.' then raise; end if; end;
 begin perform public.share_workspace('bid','10000000-0000-4000-8000-000000000011','outsider@example.test','editor'); raise exception 'Editor shared bid';
 exception when raise_exception then if sqlerrm<>'Only the creator can manage collaborators' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000013',true);
do $$ begin
 if exists(select 1 from public.bids) or exists(select 1 from public.bid_memberships) then raise exception 'Private bids leaked'; end if;
 begin perform public.save_bid('{"id":"10000000-0000-4000-8000-000000000011","version":1,"parcel":{},"screening":{},"project":{}}',2); raise exception 'Uninvited write';
 exception when raise_exception then if sqlerrm<>'Editor access required' then raise; end if; end;
 begin perform public.save_bid('{"id":"10000000-0000-4000-8000-000000000011","version":1,"parcel":{},"screening":{},"project":{}}',0); raise exception 'Claimed another owner bid';
 exception when unique_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
select public.share_workspace('bid','10000000-0000-4000-8000-000000000011','editor@example.test','reviewer');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',true);
do $$ begin
 if not exists(select 1 from public.bids) then raise exception 'Reviewer cannot read'; end if;
 begin perform public.save_bid('{"id":"10000000-0000-4000-8000-000000000011","version":1,"parcel":{},"screening":{},"project":{}}',2); raise exception 'Reviewer wrote bid';
 exception when raise_exception then if sqlerrm<>'Editor access required' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
select public.share_workspace('bid','10000000-0000-4000-8000-000000000011','editor@example.test','remove');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000012',true);
do $$ begin if exists(select 1 from public.bids) then raise exception 'Revoked access remains'; end if; end $$;
set local role anon;
do $$ begin
 begin perform * from public.bids; raise exception 'Anonymous read'; exception when insufficient_privilege then null; end;
 begin perform public.share_workspace('bid','10000000-0000-4000-8000-000000000011','outsider@example.test','editor'); raise exception 'Anonymous share'; exception when insufficient_privilege then null; end;
end $$;
rollback;
