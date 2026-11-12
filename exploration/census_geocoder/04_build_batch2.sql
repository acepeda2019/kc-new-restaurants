-- batch2: (a) stripped-unit variants of all 26 failures and 92 non-exact-with-unit rows (id suffix _s),
-- (b) 100 exact resubmits of batch1 rows for determinism (same ids), (c) synthetic probes (id probe_N).
create or replace table out1 as select * from read_csv('data/batch1_output.csv', header=false, all_varchar=true, delim=',', quote='"', escape='"', null_padding=true, auto_detect=false,
 columns={'id':'varchar','input_address':'varchar','match':'varchar','match_type':'varchar','matched_address':'varchar','coords':'varchar','tiger_line_id':'varchar','side':'varchar'});
create or replace table m as select b.*, o.match, o.match_type, o.coords from read_parquet('data/batch1_meta.parquet') b join out1 o using(id);
create or replace function strip_unit(s) as
  trim(regexp_replace(regexp_replace(s, ',.*$', ''), '\s+(#|STE\.?|SUITE|UNIT|SPACE|BLDG)\s*\S+$', '', 'i'));
create or replace table b2 as
 select id||'_s' as id, strip_unit(street) as street, city, state, zip from m
   where (match<>'Match' or match_type='Non_Exact') and strip_unit(street)<>street
 union all
 select id, street, city, state, zip from (select * from m where match='Match' order by id limit 100)
 union all
 select * from (values ('probe_pobox','PO BOX 1234','SEATTLE','WA','98101'),
   ('probe_hwy99','15000 HWY 99','LYNNWOOD','WA','98037'),
   ('probe_sr99','SR 99 AND 200TH ST','SEATAC','WA','98198'),
   ('probe_blank_num','MAIN ST','SEATTLE','WA','98101'),
   ('probe_noZip','400 BROAD ST','SEATTLE','WA',''),
   ('probe_zip4','400 BROAD ST','SEATTLE','WA','98109-4610'),
   ('probe_nocity','400 BROAD ST','','WA','98109'),
   ('probe_wrongcity','400 BROAD ST','TACOMA','WA','98109'),
   ('probe_unitinline','400 BROAD ST STE 100','SEATTLE','WA','98109'),
   ('probe_airport','17801 INTERNATIONAL BLVD','SEATAC','WA','98158'));
select count(*) from b2;
copy b2 to 'data/batch2_input.csv' (header false, quote '"', force_quote (street,city));
