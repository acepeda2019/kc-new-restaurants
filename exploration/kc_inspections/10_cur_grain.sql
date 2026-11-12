-- Run from data/. Grain / keys on current (r878-4sxa), from full-dataset aggregates (agg/cur_inspections_*.json = group by inspection attrs).
create table insp as select * from read_json_auto(['agg/cur_inspections_0.json','agg/cur_inspections_50000.json']);
select count(*) n_groups, count(distinct inspection_serial_num) n_serial, count(distinct (inspection_serial_num,business_id)) n_ser_biz, sum(n_rows::int) tot_rows from insp;
-- serial -> more than one business / date / type?
select count(*) as serials_with_multi_attr from (select inspection_serial_num from insp group by 1 having count(*)>1);
-- zero-violation inspections: rows per inspection when n_violations=0
select (n_violations::int=0) zero_viol, count(*) n_insp, min(n_rows::int) min_rows, max(n_rows::int) max_rows, sum(n_rows::int) rows_ from insp group by 1;
-- zero-violation: score and result
select inspection_type, inspection_result, count(*) n, sum((n_violations::int=0)::int) zero_viol, avg(inspection_score::double) avg_score from insp group by all order by n desc;
-- inspections with violations but score 0?
select count(*) from insp where n_violations::int>0 and coalesce(inspection_score::double,0)=0;
select count(*) from insp where n_violations::int=0 and coalesce(inspection_score::double,0)>0;
-- serial format
select length(inspection_serial_num) len, left(inspection_serial_num,4) p, count(*) n, min(inspection_date), max(inspection_date) from insp group by all order by 1,2;
select length(business_id) len, left(business_id,7) p, count(*) from (select distinct business_id from insp) group by all order by 3 desc limit 6;
-- same business, same date, multiple serials?
select count(*) from (select business_id, inspection_date, count(*) c from insp group by all having c>1);
