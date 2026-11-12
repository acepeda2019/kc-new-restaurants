-- Run from data/. Do business_id / serial keys survive the republish? Compare by address+date instead.
create view L as select * from read_json_auto('sample/legacy_safeway_filter_29us-kypr.json');
create view C as select * from read_json_auto('sample/cur_safeway_albertsons.json');
select business_id, inspection_serial_num, name, address, inspection_date, inspection_score from L where inspection_date>='2025-01-01' order by address, inspection_date limit 6;
select business_id, inspection_serial_num, name, address, inspection_date, inspection_score from C where inspection_date between '2025-01-01' and '2025-12-30' order by address, inspection_date limit 6;
select 'L' s, length(business_id) len, left(business_id,2) pre, count(*) n from L group by all
union all select 'C', length(business_id), left(business_id,2), count(*) from C group by all;
select 'L' s, length(inspection_serial_num) len, count(*) n from L group by all union all select 'C', length(inspection_serial_num), count(*) from C group by all;
select count(*) as n_match, sum((l.sc=c.sc)::int) as same_score from
 (select distinct upper(address) a, inspection_date d, inspection_score::int sc from L where inspection_date>='2021-01-01') l
 join (select distinct upper(address) a, inspection_date d, inspection_score::int sc from C) c on l.a=c.a and l.d=c.d;
select count(*) as n_legacy_addr_date from (select distinct upper(address), inspection_date from L where inspection_date>='2021-01-01');
select count(*) as n_cur_addr_date_le_legacy_max from (select distinct upper(address), inspection_date from C where inspection_date<='2025-11-26');
