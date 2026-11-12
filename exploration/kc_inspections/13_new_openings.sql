-- Run from data/. New-openings volume across both datasets. Legacy business list = sgr5-u9rw (as of 2025-12) union j2pu-r4ru (as of 2024-09),
-- matched to current by normalized (name, address) because legacy and current business_ids differ in format (PR0xxxxxxx vs PFE-PR-xxxxxxx).
create table insp as select * from read_json_auto(['agg/cur_inspections_0.json','agg/cur_inspections_50000.json']);
create table ba as select * from read_json_auto('agg/cur_business_attrs.json');
create macro nrm(s) as regexp_replace(upper(trim(coalesce(s,''))), '[^A-Z0-9]', '', 'g');
create macro nrm_addr(s) as regexp_replace(regexp_replace(upper(trim(coalesce(s,''))), '\s+(UNIT|STE|SUITE|APT|BLDG|SPACE|#).*$', ''), '[^A-Z0-9]', '', 'g');
create table leg as
 select business_id, name, address, 'sgr5' src from read_json_auto('sample/legacy_businesses_sgr5-u9rw.json')
 union all select business_id, name, address, 'j2pu' from read_json_auto('sample/legacy_food_establishments_j2pu-r4ru.json');
select count(*) n_leg_rows, count(distinct business_id) n_leg_biz from leg;
create table leg_keys as select distinct nrm(name) n, nrm_addr(address) a from leg;
create table leg_addr as select distinct nrm_addr(address) a from leg;
create table firsts as
 select i.business_id, i.inspection_date::date d, i.inspection_type, i.inspection_result, i.n_violations::int nv, i.inspection_score::double score, i.inspection_serial_num,
        row_number() over (partition by i.business_id order by i.inspection_date, i.inspection_serial_num) rn from insp i;
create table nb as
 select b.business_id, b.name, b.program_identifier, b.address, b.zip_code, b.classification, b.seating_range, b.risk_category, f.d first_d, f.inspection_type, f.inspection_result, f.nv, f.score,
        (nrm(b.name)||'|'||nrm_addr(b.address)) in (select n||'|'||a from leg_keys) as in_legacy_name_addr,
        nrm_addr(b.address) in (select a from leg_addr) as in_legacy_addr
 from ba b join firsts f on f.business_id=b.business_id and f.rn=1;
-- monthly, last 12 months, all classifications
select strftime(first_d,'%Y-%m') m, count(*) new_ids, sum((not in_legacy_name_addr)::int) not_in_legacy_name_addr, sum((not in_legacy_addr)::int) not_in_legacy_addr
 from nb where first_d>='2025-11-01' group by 1 order by 1;
-- same, general food services + mobile + bakery only, not in legacy name+addr
select strftime(first_d,'%Y-%m') m, count(*) new_ids_gfs_bake_mobile, sum((not in_legacy_name_addr)::int) not_in_legacy
 from nb where first_d>='2025-11-01' and classification in ('General Food Services','General Food Service','Bakery','Mobile Food Unit','Limited Food Service') group by 1 order by 1;
-- how many legacy-list businesses ever appear in current by name+addr (sanity)
select count(*) cur_biz, sum(((nrm(name)||'|'||nrm_addr(address)) in (select n||'|'||a from leg_keys))::int) in_leg from ba;
-- first inspection types for businesses first seen >=2023-01 (past censoring)
select inspection_type, inspection_result, count(*) n from nb where first_d>='2023-01-01' group by all order by n desc;
select inspection_type, count(*) n, avg(nv) avg_viol, avg(score) avg_score from nb where first_d>='2023-01-01' group by all;
-- ratio of businesses with an educational inspection as first
select classification, count(*) from nb where first_d>='2025-11-12' group by 1 order by 2 desc;
-- ID family vs legacy match (new-system 6-digit ids vs 7-digit ids, first inspected since 2025-12-01)
select case when business_id ~ '^PFE-PR-[0-9]{6}$' then 'six_digit_new_system' when business_id ~ '^PFE-PR-[0-9]{7}$' then 'seven_digit' else 'other(SFE)' end fam,
  count(*) n, sum(in_legacy_name_addr::int) in_legacy_name_addr, sum(in_legacy_addr::int) in_legacy_addr from nb where first_d>='2025-12-01' group by 1 order by 1;
-- last 12 months totals (2025-11-13 .. 2026-11-12)
select count(*) new_ids_12m, sum((not in_legacy_name_addr)::int) not_in_legacy_name_addr,
  sum((classification in ('General Food Services','General Food Service','Bakery','Mobile Food Unit','Limited Food Service'))::int) cand_classes,
  sum((classification in ('General Food Services','General Food Service','Bakery','Limited Food Service') and not in_legacy_name_addr)::int) cand_classes_nonmobile_notinlegacy
 from nb where first_d>='2025-11-13';
