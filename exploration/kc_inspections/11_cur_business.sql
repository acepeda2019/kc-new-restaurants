-- Run from data/. Business grain on current, from agg/cur_business_attrs.json (full dataset grouped by business attributes).
create table ba as select * from read_json_auto('agg/cur_business_attrs.json');
select count(*) n_attr_rows, count(distinct business_id) n_biz from ba;
-- attribute drift: which attribute changes within a business_id?
select 'name' c, count(*) from (select business_id from ba group by 1 having count(distinct name)>1)
union all select 'program_identifier', count(*) from (select business_id from ba group by 1 having count(distinct program_identifier)>1)
union all select 'address', count(*) from (select business_id from ba group by 1 having count(distinct address)>1)
union all select 'zip', count(*) from (select business_id from ba group by 1 having count(distinct zip_code)>1)
union all select 'classification', count(*) from (select business_id from ba group by 1 having count(distinct classification)>1)
union all select 'seating', count(*) from (select business_id from ba group by 1 having count(distinct seating_range)>1)
union all select 'risk', count(*) from (select business_id from ba group by 1 having count(distinct risk_category)>1)
union all select 'parcel', count(*) from (select business_id from ba group by 1 having count(distinct parcel_number)>1);
-- name vs program_identifier
select sum((name=program_identifier)::int) same, sum((name<>program_identifier)::int) diff, sum((program_identifier is null)::int) null_pi from ba;
select name, program_identifier, address, classification from ba where program_identifier is not null and name<>program_identifier limit 8;
-- prefix
select left(business_id,7) p, classification, count(distinct business_id) n from ba group by all order by 1,3 desc;
-- name/address formats
select count(*) filter (where regexp_matches(address,'(?i)(unit|ste|suite|#|apt|bldg|space)')) with_unit_noise, count(*) filter (where address <> upper(address)) not_upper, count(*) filter (where length(zip_code)>5) zip_plus4, count(*) filter (where zip_code is null) zip_null from (select distinct business_id, address, zip_code from ba);
select address from (select distinct address from ba) where regexp_matches(address,'(?i)(\bunit\b|\bste\b|suite|#|\bapt\b|bldg|space)') limit 10;
select zip_code, count(*) from (select distinct business_id, zip_code from ba) group by 1 order by 2 desc limit 5;
select count(*) null_parcel from (select distinct business_id from ba where parcel_number is null);
select parcel_number from ba limit 3;
select distinct city from ba order by 1 limit 100;
