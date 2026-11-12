-- Run from exploration/census_geocoder/: duckdb < 01_build_batch.sql
-- Distinct non-mobile business addresses from the KC 50k sample; seeded random 500.
create or replace table addrs as
select address, city, zip_code, any_value(business_id) as business_id, any_value(name) as name
from read_json_auto('../kc_inspections/data/sample/cur_recent_50k.json')
where classification <> 'Mobile Food Unit'
group by 1,2,3;
select count(*) as distinct_addr_sample from addrs;
select setseed(0.42);
create or replace table batch1 as
select substr(md5(trim(address)||'|'||coalesce(trim(city),'')||'|'||coalesce(trim(zip_code),'')),1,16) as id,
       trim(address) as street, trim(city) as city, 'WA' as state, trim(zip_code) as zip, business_id, name
from addrs order by random() limit 500;
select count(*), count(distinct id) from batch1;
copy (select id,street,city,state,zip from batch1) to 'data/batch1_input.csv' (header false, quote '"', force_quote (street,city));
copy batch1 to 'data/batch1_meta.parquet';
