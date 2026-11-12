-- Run from exploration/kc_inspections/data. Legacy (29us-kypr = Safeway/Albertsons filter of f29f-zza5) vs current for same names.
create view L as select * from read_json_auto('sample/legacy_safeway_filter_29us-kypr.json');
create view C as select * from read_json_auto('sample/cur_safeway_albertsons.json');
select 'legacy 2021+' k, count(*) n_rows, count(distinct inspection_serial_num) ser, count(distinct business_id) b from L where inspection_date>='2021-01-01'
union all select 'cur <=2025-11-26', count(*), count(distinct inspection_serial_num), count(distinct business_id) from C where inspection_date<='2025-11-26';
select 'serial in both' k, count(*) from (select distinct inspection_serial_num s from L where inspection_date>='2021-01-01') a join (select distinct inspection_serial_num s from C) b using(s);
select 'bid in both', count(*) from (select distinct business_id s from L) a join (select distinct business_id s from C) b using(s);
select 'legacy 2021+ ser not in cur', count(*) from (select distinct inspection_serial_num s from L where inspection_date>='2021-01-01') where s not in (select inspection_serial_num from C);
select 'cur<=2025-11-26 ser not in legacy', count(*) from (select distinct inspection_serial_num s from C where inspection_date<='2025-11-26') where s not in (select inspection_serial_num from L);
select 'cur after legacy max', count(distinct inspection_serial_num) from C where inspection_date>'2025-11-26';
-- row-level comparison for shared serials: same row count? same violation set?
with l as (select inspection_serial_num s, count(*) n, count(violation_description) nv, max(inspection_score) sc from L group by 1),
     c as (select inspection_serial_num s, count(*) n, count(violation_description) nv, max(inspection_score) sc from C group by 1)
select count(*) shared, sum((l.n=c.n)::int) same_rows, sum((l.nv=c.nv)::int) same_viol, sum((l.sc=c.sc)::int) same_score from l join c using(s);
select min(inspection_date), max(inspection_date) from L;
