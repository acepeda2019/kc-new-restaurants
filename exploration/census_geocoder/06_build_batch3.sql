-- batch3: 2000 random distinct stripped+upper addresses from the sample (excluding batch1 addresses), to measure scale timing and stripped match rate
create or replace function strip_unit(s) as
  trim(regexp_replace(regexp_replace(s, ',.*$', ''), '\s+(#|STE\.?|SUITE|UNIT|SPACE|BLDG)\s*\S+$', '', 'i'));
create or replace table k as
select strip_unit(upper(trim(address))) street, upper(trim(city)) city, left(trim(zip_code),5) zip, count(*) n_src, any_value(classification) c
from read_json_auto('../kc_inspections/data/sample/cur_recent_50k.json') where classification<>'Mobile Food Unit' group by 1,2,3;
select count(*) distinct_stripped_upper_nonmobile_in_sample from k;
select count(*) distinct_raw from (select distinct address,city,zip_code from read_json_auto('../kc_inspections/data/sample/cur_recent_50k.json') where classification<>'Mobile Food Unit');
select count(*) distinct_stripped_upper_all from (select distinct strip_unit(upper(trim(address))), upper(trim(city)), left(trim(zip_code),5) from read_json_auto('../kc_inspections/data/sample/cur_recent_50k.json'));
select setseed(0.7);
create or replace table b3 as
select substr(md5(street||'|'||city||'|'||zip),1,16) id, street, city, 'WA' state, zip from k
where substr(md5(street||'|'||city||'|'||zip),1,16) not in (select id from read_parquet('data/batch1_meta.parquet')) order by random() limit 2000;
copy b3 to 'data/batch3_input.csv' (header false, quote '"', force_quote (street,city));
