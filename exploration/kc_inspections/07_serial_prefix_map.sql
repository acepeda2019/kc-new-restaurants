-- Run from data/. Hypothesis: current serial = 'PFE-' || legacy serial; business IDs are re-keyed.
create view L as select * from read_json_auto('sample/legacy_safeway_filter_29us-kypr.json');
create view C as select * from read_json_auto('sample/cur_safeway_albertsons.json');
select left(inspection_serial_num,4) pre, length(inspection_serial_num) len, count(distinct inspection_serial_num) n, min(inspection_date), max(inspection_date) from C group by all order by 1,2;
select count(distinct replace(c.inspection_serial_num,'PFE-','')) shared_serials from C c join L l on replace(c.inspection_serial_num,'PFE-','')=l.inspection_serial_num;
select count(distinct l.inspection_serial_num) legacy_2021p, count(distinct c.inspection_serial_num) matched_in_cur
 from L l left join C c on replace(c.inspection_serial_num,'PFE-','')=l.inspection_serial_num where l.inspection_date>='2021-01-01';
-- 1:1 mapping of business ids via shared serial
with m as (select distinct l.business_id lb, c.business_id cb from L l join C c on replace(c.inspection_serial_num,'PFE-','')=l.inspection_serial_num)
select count(*) pairs, count(distinct lb) lb, count(distinct cb) cb from m;
-- inspections in legacy 2021+ not found in current by serial: by month
select strftime(l.inspection_date::date,'%Y') y, count(distinct l.inspection_serial_num) n_legacy, count(distinct c.inspection_serial_num) n_in_cur
 from L l left join C c on replace(c.inspection_serial_num,'PFE-','')=l.inspection_serial_num where l.inspection_date>='2019-01-01' group by 1 order by 1;
-- current serials without PFE- and long ones
select inspection_serial_num, inspection_date, business_id from C where inspection_serial_num not like 'PFE-%' or length(inspection_serial_num)>13 limit 8;
-- current serials <= 2025-11-26 that are not in legacy even after stripping
select count(distinct inspection_serial_num) from C where inspection_date<='2025-11-26' and replace(inspection_serial_num,'PFE-','') not in (select inspection_serial_num from L);
-- score/violation comparison for shared serials
with l as (select inspection_serial_num s, count(*) n, count(violation_description) nv, max(inspection_score::int) sc, sum(violation_points::int) pts from L group by 1),
     c as (select replace(inspection_serial_num,'PFE-','') s, count(*) n, count(violation_description) nv, max(inspection_score::double) sc, sum(violation_points::double) pts from C group by 1)
select count(*) shared, sum((l.n=c.n)::int) same_rowcount, sum((l.nv=c.nv)::int) same_viol_count, sum((l.sc=c.sc)::int) same_score, sum((l.pts=c.pts)::int) same_pts from l join c using(s);
