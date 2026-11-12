-- Run from data/. First-ever inspection per business in current; monthly new-business counts; first inspection type.
create table insp as select * from read_json_auto(['agg/cur_inspections_0.json','agg/cur_inspections_50000.json']);
create table ba as select * from read_json_auto('agg/cur_business_attrs.json');
create table first_insp as
 select business_id, inspection_date::date d, inspection_type, inspection_result, inspection_serial_num, n_violations::int nv, inspection_score::double score,
        row_number() over (partition by business_id order by inspection_date, inspection_serial_num) rn from insp;
-- first_date by month (look for the 2021 left-censoring artifact and steady-state level)
select strftime(first_date::date,'%Y-%m') m, count(*) n_new_biz from ba group by 1 order by 1;
