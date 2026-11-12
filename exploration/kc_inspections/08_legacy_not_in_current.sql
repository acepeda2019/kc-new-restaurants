-- Run from data/. Which legacy 2021+ Safeway inspections are missing from current?
create view L as select * from read_json_auto('sample/legacy_safeway_filter_29us-kypr.json');
create view C as select * from read_json_auto('sample/cur_safeway_albertsons.json');
create view miss as select distinct l.inspection_serial_num s, l.business_id, l.inspection_type, l.inspection_date, l.inspection_result, l.description, l.name
 from L l where l.inspection_date>='2021-01-01' and 'PFE-'||l.inspection_serial_num not in (select inspection_serial_num from C);
select inspection_type, inspection_result, count(*) from miss group by all order by 3 desc;
select count(distinct business_id) biz_with_missing from miss;
select business_id, name, count(*) n, min(inspection_date), max(inspection_date) from miss group by all order by n desc limit 8;
-- are those businesses wholly absent from current (by mapped id)?
select count(distinct m.business_id) b_missing_wholly from miss m where m.business_id not in (select distinct l.business_id from L l join C c on 'PFE-'||l.inspection_serial_num=c.inspection_serial_num);
-- legacy inspection type values
select inspection_type, count(distinct inspection_serial_num) from L group by all order by 2 desc;
select description, count(distinct business_id) from L group by all order by 2 desc;
