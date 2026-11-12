-- duckdb < 03_analyze.sql   (batch1 results)
create or replace table out1 as
select * from read_csv('data/batch1_output.csv', header=false, all_varchar=true, delim=',', quote='"', escape='"', null_padding=true, auto_detect=false,
 columns={'id':'varchar','input_address':'varchar','match':'varchar','match_type':'varchar','matched_address':'varchar','coords':'varchar','tiger_line_id':'varchar','side':'varchar'});
select count(*) n, count(distinct id) d from out1;
select match, match_type, count(*) from out1 group by all order by 3 desc;
select count(*) as in_order_same_as_input from (select row_number() over () rn, id from out1) a;
-- kinds of failures
create or replace table f as
select o.id, o.match, b.street, b.city, b.zip, b.name, b.business_id from out1 o join read_parquet('data/batch1_meta.parquet') b using(id) where o.match<>'Match';
select count(*) from f;
select street, city, zip, name from f order by street;
-- pattern classification
select case when regexp_matches(street, '(,|#|\bSTE\b|\bSUITE\b|\bUNIT\b|\bSPACE\b|\bBLDG\b)', 'i') then 'unit_text'
            when not regexp_matches(street, '^[0-9]') then 'no_leading_number'
            when regexp_matches(street, '(HWY|HIGHWAY|\bSR\b|US )', 'i') then 'highway'
            else 'other' end as kind, count(*) from f group by 1;
-- matched overall rate by whether the input had unit text
select (regexp_matches(b.street, '(,|#|\bSTE\b|\bSUITE\b|\bUNIT\b|\bSPACE\b|\bBLDG\b)', 'i')) has_unit, o.match, o.match_type, count(*)
from out1 o join read_parquet('data/batch1_meta.parquet') b using(id) group by all order by 1,2,3;
-- coordinates sanity: inside KC bbox?
select count(*) n_matched, sum((try_cast(split_part(coords,',',1) as double) between -122.55 and -121.05 and try_cast(split_part(coords,',',2) as double) between 47.05 and 47.80)::int) in_kc_bbox,
 min(try_cast(split_part(coords,',',1) as double)) minx, max(try_cast(split_part(coords,',',1) as double)) maxx
from out1 where match='Match';
-- city mismatch matched vs input
select count(*) filter (where upper(split_part(matched_address,', ',-3))<>upper(b.city)) city_differs, count(*) from out1 o join read_parquet('data/batch1_meta.parquet') b using(id) where match='Match';
select b.city, split_part(matched_address,', ',-3) mc, count(*) from out1 o join read_parquet('data/batch1_meta.parquet') b using(id) where match='Match' and upper(split_part(matched_address,', ',-3))<>upper(b.city) group by all order by 3 desc limit 15;
-- row order preserved?
create or replace table inp as select row_number() over () rn, column0 as id from read_csv('data/batch1_input.csv', header=false, all_varchar=true);
create or replace table outo as select row_number() over () rn, id from out1;
select count(*) filter (where i.id=o.id) same_position, count(*) from inp i join outo o using(rn);
-- non-exact: how do they differ from input
select b.street, b.city, o.matched_address from out1 o join read_parquet('data/batch1_meta.parquet') b using(id) where match_type='Non_Exact' order by random() limit 25;
select side, count(*) from out1 where match='Match' group by 1;
