-- Run from data/. Legacy description vs current classification/seating/risk for the same inspections (Safeway/Albertsons subset); legacy business-level views quality.
create view L as select * from read_json_auto('sample/legacy_safeway_filter_29us-kypr.json');
create view C as select * from read_json_auto('sample/cur_safeway_albertsons.json');
select l.description, c.classification, c.seating_range, c.risk_category, count(distinct l.business_id) n_biz
 from L l join C c on 'PFE-'||l.inspection_serial_num=c.inspection_serial_num group by all order by n_biz desc;
-- legacy vs current same inspection: other column diffs
select sum((l.name=c.name)::int) same_name, sum((coalesce(l.program_identifier,'')=coalesce(c.program_identifier,''))::int) same_prog, sum((l.address=c.address)::int) same_addr, sum((l.zip_code=c.zip_code)::int) same_zip, sum((l.inspection_closed_business::varchar = lower(c.inspection_closed_business))::int) same_closed, count(*) n
 from L l join C c on 'PFE-'||l.inspection_serial_num=c.inspection_serial_num and coalesce(l.violation_description,'')=coalesce(c.violation_description,'');
select l.grade lgrade, c.grade cgrade, count(*) from L l join C c on 'PFE-'||l.inspection_serial_num=c.inspection_serial_num group by all order by 3 desc limit 8;
select l.violation_type, c.violation_type, count(*) from L l join C c on 'PFE-'||l.inspection_serial_num=c.inspection_serial_num group by all;
-- legacy lat/long nulls
select count(*) n, count(latitude) lat, count(phone) phone, count(zip_code) zip, count(violation_record_id) vrid, count(distinct violation_record_id) d_vrid, count(violation_description) vd from L;
-- legacy: violation_record_id unique?
select count(*) from (select violation_record_id from L where violation_record_id is not null group by 1 having count(*)>1);
select distinct inspection_closed_business, inspection_result, grade from L order by 1,2,3;
-- business-level legacy views
create view S as select * from read_json_auto('sample/legacy_businesses_sgr5-u9rw.json');
create view J as select * from read_json_auto('sample/legacy_food_establishments_j2pu-r4ru.json');
select 'sgr5' v, count(*) n, count(distinct business_id) d, count(latitude) lat, count(distinct grade) g, min(business_id), max(business_id) from S
union all select 'j2pu', count(*), count(distinct business_id), count(location), null, min(business_id), max(business_id) from J;
select count(*) from (select business_id from S group by 1 having count(*)>1);
select count(*) in_both from (select distinct business_id from S) join (select distinct business_id from J) using(business_id);
select max(inspections::int), sum(inspections::int) from J;
