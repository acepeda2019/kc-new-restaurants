create or replace function strip_unit(s) as trim(regexp_replace(regexp_replace(s, ',.*$', ''), '\s+(#|STE\.?|SUITE|UNIT|SPACE|BLDG)\s*\S+$', '', 'i'));
create or replace table k as select distinct regexp_replace(strip_unit(upper(trim(address))),'\s+',' ','g') s, upper(trim(city)) c, left(trim(zip_code),5) z
 from read_json_auto('../kc_inspections/data/sample/cur_recent_50k.json') where classification<>'Mobile Food Unit';
select count(*) street_city_zip, (select count(*) from (select distinct s,z from k)) street_zip from k;
select count(*) null_or_blank_zip from k where z is null or z='';
