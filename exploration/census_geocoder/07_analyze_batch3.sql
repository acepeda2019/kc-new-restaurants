create or replace table o3 as select * from read_csv('data/batch3_output.csv', header=false, all_varchar=true, delim=',', quote='"', escape='"', null_padding=true, auto_detect=false,
 columns={'id':'varchar','input_address':'varchar','match':'varchar','match_type':'varchar','matched_address':'varchar','coords':'varchar','tiger_line_id':'varchar','side':'varchar'});
select count(*), count(distinct id) from o3;
select match, match_type, count(*), round(100.0*count(*)/2000,1) pct from o3 group by all order by 3 desc;
create or replace table i3 as select * from read_csv('data/batch3_input.csv', header=false, all_varchar=true, columns={'id':'varchar','street':'varchar','city':'varchar','state':'varchar','zip':'varchar'});
select case when not regexp_matches(street, '^[0-9]') then 'no_leading_number' when regexp_matches(street,'(HWY|HIGHWAY|\bSR\b|\bUS\b|PKWY)') then 'hwy_pkwy' when regexp_matches(street,'(MALL|SQ\b|SQUARE|VILLAGE|PLZ|PLAZA|CENTER|OUTLET|STATION|LANDING)') then 'mall_village_plaza' else 'other' end kind, count(*) from o3 join i3 using(id) where match<>'Match' group by 1 order by 2 desc;
select street, city, zip, match from o3 join i3 using(id) where match<>'Match' order by random() limit 30;
-- non-exact in stripped batch: do they change the street number?
select count(*) nonexact, count(*) filter (where split_part(i3.street,' ',1)<>split_part(matched_address,' ',1)) numdiff from o3 join i3 using(id) where match_type='Non_Exact';
select i3.street, i3.city, matched_address from o3 join i3 using(id) where match_type='Non_Exact' order by random() limit 12;
select 'zip_differs', count(*) filter (where right(matched_address,5)<>i3.zip), count(*) from o3 join i3 using(id) where match='Match';
-- lat/long in KC?
select count(*) n, count(*) filter (where try_cast(split_part(coords,',',1) as double) not between -122.6 and -121.05 or try_cast(split_part(coords,',',2) as double) not between 47.0 and 47.8) outside_kc_bbox from o3 where match='Match';
-- failure by place type, clearer: all failures in batch3
select case when not regexp_matches(street, '^[0-9]') then 'no_leading_number'
 when regexp_matches(street,'(HWY|HIGHWAY|\bSR\b|\bUS\b)') then 'highway'
 when regexp_matches(street,'(MALL|\bSQ\b|SQUARE|VILLAGE|\bPLZ\b|PLAZA|CENTER|OUTLET|STATION|LANDING|COMMONS)') then 'mall/village/plaza/commons'
 when regexp_matches(street,'(INTERNATIONAL BLVD)') then 'international_blvd'
 else 'other_regular_street' end kind, match, count(*) from o3 join i3 using(id) where match<>'Match' group by all order by 3 desc;
