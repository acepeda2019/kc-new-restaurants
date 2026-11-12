-- Run from data/. Food trucks, ownership changes, multi-tenant addresses on current (agg/cur_business_attrs.json).
create table ba as select * from read_json_auto('agg/cur_business_attrs.json');
create macro nrm(s) as regexp_replace(upper(trim(coalesce(s,''))), '[^A-Z0-9]', '', 'g');
create macro nrm_addr(s) as regexp_replace(regexp_replace(upper(trim(coalesce(s,''))), '(\s+(UNIT|STE|SUITE|APT|BLDG|SPACE|#)\b.*$|,.*$)', ''), '[^A-Z0-9]', '', 'g');
-- MOBILE: addresses shared by many units?
create table mob as select *, nrm_addr(address) na from ba where classification='Mobile Food Unit';
select count(*) n_mobile, count(distinct na) n_addr, count(distinct zip_code) n_zip from mob;
select na, any_value(address) addr, any_value(city) city, count(*) n_units, any_value(name) ex_name from mob group by na order by n_units desc limit 12;
select count(*) n_addr_with_1_unit from (select na from mob group by na having count(*)=1);
select count(*) units_at_addr_shared_by_3plus from mob where na in (select na from mob group by na having count(*)>=3);
select name, program_identifier, address, city, zip_code from mob order by hash(business_id) limit 12;
-- Mobile units whose address equals address of a Commissary Kitchen / Catering business
select count(*) mob_at_commissary_addr from mob where na in (select nrm_addr(address) from ba where classification like 'Commissary%');
select count(*) mob_addr_shared_with_nonmobile from mob where na in (select nrm_addr(address) from ba where classification<>'Mobile Food Unit');
-- mobile units: do addresses look like residential (house number street) -> can't tell; share by city
select city, count(*) n from mob group by 1 order by 2 desc limit 8;
-- OWNERSHIP: same normalized address, different business_id, name-similar, gap between last_date of old and first_date of new
create table pairs as
 select a.business_id old_id, b.business_id new_id, a.name old_name, b.name new_name, a.address, a.classification oc, b.classification nc,
        a.first_date::date o_first, a.last_date::date old_last, b.first_date::date new_first,
        date_diff('day', a.last_date::date, b.first_date::date) gap_days,
        jaro_winkler_similarity(nrm(a.name), nrm(b.name)) sim
 from ba a join ba b on nrm_addr(a.address)=nrm_addr(b.address) and a.business_id<>b.business_id
   and a.last_date::date < b.first_date::date + interval 1 day and a.first_date < b.first_date
 where a.classification in ('General Food Services','Limited Food Service','Bakery') and b.classification in ('General Food Services','Limited Food Service','Bakery')
   and nrm_addr(a.address) not in (select na from (select nrm_addr(address) na, count(*) c from ba group by 1 having count(*)>=8));
-- new IDs (first inspected after 2022-06 to avoid left-censoring) whose address had an earlier-ID food business ending within 12 months before
create table nb as select b.* from ba b where b.first_date::date>='2022-06-01' and b.classification in ('General Food Services','Limited Food Service','Bakery');
create table cand as
 select p.* from pairs p join nb on nb.business_id=p.new_id where p.gap_days between -30 and 365;
select count(*) n_new_ids_considered from nb;
select count(distinct new_id) new_ids_with_prior_biz_at_addr_12m from cand;
select count(distinct new_id) filter (where sim>=0.90) similar_name_ge90, count(distinct new_id) filter (where sim between 0.75 and 0.9) mid_75_90, count(distinct new_id) filter (where sim<0.75) dissimilar from cand;
select * exclude(oc,nc,o_first) from cand where sim>=0.9 order by new_first desc limit 8;
select * exclude(oc,nc,o_first) from cand where sim<0.75 order by new_first desc limit 8;
select * exclude(oc,nc,o_first) from cand where sim between 0.75 and 0.9 order by new_first desc limit 6;
-- same-name, different ID, same address, old ID ended: strongest ownership-transfer signal
select count(distinct new_id) same_exact_name from cand where nrm(old_name)=nrm(new_name);
-- MULTI-TENANT: addresses with several concurrently active businesses (inspected in last 365 days)
create table act as select *, nrm_addr(address) na from ba where last_date::date >= date '2026-11-12' - 365 and classification in ('General Food Services','General Food Service','Limited Food Service','Bakery','Mobile Food Unit');
select n_active, count(*) n_addr from (select na, count(*) n_active from act group by 1) group by 1 order by 1;
select na, any_value(address) addr, any_value(city) city, count(*) n_active, string_agg(distinct name, '; ') filter (where true) names from act group by na having count(*)>=8 order by n_active desc limit 12;
