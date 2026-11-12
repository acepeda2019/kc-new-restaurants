-- duckdb -markdown < 05_analyze_batch2.sql
create or replace macro rd(f) as table select * from read_csv(f, header=false, all_varchar=true, delim=',', quote='"', escape='"', null_padding=true, auto_detect=false,
 columns={'id':'varchar','input_address':'varchar','match':'varchar','match_type':'varchar','matched_address':'varchar','coords':'varchar','tiger_line_id':'varchar','side':'varchar'});
create or replace table o1 as select * from rd('data/batch1_output.csv');
create or replace table o2 as select * from rd('data/batch2_output.csv');
-- (a) strip effect on failures
select 'failures(26) -> stripped' grp, o2.match, o2.match_type, count(*) from o2 join o1 on o2.id=o1.id||'_s' where o1.match<>'Match' group by all;
select 'failures w/ no strip possible (not sent)' grp, count(*) from o1 where match<>'Match' and id||'_s' not in (select id from o2);
-- (a2) non-exact with unit -> stripped
select 'nonexact(unit) -> stripped' grp, o2.match, o2.match_type, count(*) as n,
  count(*) filter (where o2.coords=o1.coords) same_coords
from o2 join o1 on o2.id=o1.id||'_s' where o1.match='Match' and o1.match_type='Non_Exact' group by all;
-- distance between unit and stripped coords (approx metres) when different
select round(max(111000*sqrt(power(try_cast(split_part(o1.coords,',',1) as double)-try_cast(split_part(o2.coords,',',1) as double),2)*0.68+power(try_cast(split_part(o1.coords,',',2) as double)-try_cast(split_part(o2.coords,',',2) as double),2)))) max_m
from o2 join o1 on o2.id=o1.id||'_s' where o1.match='Match' and o2.match='Match' and o1.coords<>o2.coords;
-- failures recovered
select b.street orig, o2.matched_address, o2.match_type from o2 join o1 on o2.id=o1.id||'_s' join read_parquet('data/batch1_meta.parquet') b on b.id=o1.id where o1.match<>'Match' and o2.match='Match';
-- (b) determinism
select 'resubmit' grp, count(*) n, count(*) filter (where o1.match=o2.match and o1.match_type is not distinct from o2.match_type and o1.coords is not distinct from o2.coords and o1.matched_address is not distinct from o2.matched_address and o1.tiger_line_id is not distinct from o2.tiger_line_id) identical
from o2 join o1 using(id);
-- (c) probes
select id, input_address, match, match_type, matched_address, coords from o2 where id like 'probe_%' order by id;
