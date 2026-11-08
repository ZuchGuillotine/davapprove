-- Worker-written extraction checkpoints; existing RLS and save_record deny client writes.
alter table public.project_records drop constraint project_records_kind_check;
alter table public.project_records add constraint project_records_kind_check check(kind in ('candidate','coverage','job','document','fact','revision','comment','event','processing_chunk'));
