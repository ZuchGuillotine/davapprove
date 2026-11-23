begin;
set local role service_role;
insert into public.beta_events (state, county, supported, source, project_type, upgrades, coverage)
values ('WA', 'Kitsap County', true, 'web', 'adu', array['solar'], 'partial');
insert into public.beta_events (state, county, supported)
values ('AK', 'Kusilvak Census Area', false);
do $$
begin
    begin
        insert into public.beta_events (state, county, supported, source)
        values ('AK', 'Kusilvak Census Area', false, 'mcp');
        raise exception 'unsupported event accepted extra fields';
    exception when check_violation then null;
    end;
    begin
        insert into public.beta_events (state, county, supported, source, project_type, upgrades, coverage)
        values ('WA', 'Kitsap County', true, 'mcp', 'adu', array['free text'], 'partial');
        raise exception 'metrics accepted unrecognized upgrades';
    exception when check_violation then null;
    end;
end;
$$;
reset role;
do $$
begin
    if has_table_privilege('anon','public.beta_events','INSERT')
       or has_table_privilege('authenticated','public.beta_events','INSERT')
       or has_table_privilege('authenticated','public.beta_events','SELECT')
       or has_table_privilege('service_role','public.beta_events','SELECT')
       then raise exception 'metrics privileges are broader than intended';
    end if;
end;
$$;
rollback;
