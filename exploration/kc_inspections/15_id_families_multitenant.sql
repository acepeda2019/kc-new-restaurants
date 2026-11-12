-- Run from data/. (a) business_id families in current; (b) top multi-tenant addresses.
create table ba as select * from read_json_auto('agg/cur_business_attrs.json');
create macro nrm(s) as regexp_replace(upper(trim(coalesce(s,''))), '[^A-Z0-9]', '', 'g');
create macro nrm_addr(s) as regexp_replace(regexp_replace(upper(trim(coalesce(s,''))), '(\s+(UNIT|STE|SUITE|APT|BLDG|SPACE|#)\b.*$|,.*$)', ''), '[^A-Z0-9]', '', 'g');
select replace(business_id,'PFE-PR-','') ~ '^[0-9]{7}$' as seven_digit, replace(business_id,'PFE-PR-','') ~ '^[0-9]{6}$' as six_digit, count(*) n, min(first_date::date) min_first, max(first_date::date) max_first,
  count(*) filter (where first_date::date>='2025-12-01') first_since_dec25 from ba where business_id like 'PFE-PR-%' group by all;
-- 6-digit ids: how many have another id at same normalized name+address with earlier-or-equal first date (re-issued)?
create table six as select * from ba where business_id ~ '^PFE-PR-[0-9]{6}$';
select count(*) six_ids, sum((exists(select 1 from ba o where o.business_id<>six.business_id and nrm(o.name)=nrm(six.name) and nrm_addr(o.address)=nrm_addr(six.address)))::int) with_same_name_addr_other_id from six;
select count(*) six_ids_first_before_2025_12 from six where first_date::date<'2025-12-01';
select min(first_date), max(first_date) from six;
select cast(substr(business_id,8) as bigint)//1 id_num, first_date from six order by 1 limit 5;
-- multi-tenant top addresses (active in last 365 days)
create table act as select *, nrm_addr(address) na from ba where last_date::date >= date '2026-11-12' - 365 and classification in ('General Food Services','General Food Service','Limited Food Service','Bakery','Mobile Food Unit');
select na, any_value(address) addr, any_value(city) city, count(*) n_active, count(*) filter (where classification='Mobile Food Unit') n_mobile, any_value(name) ex1 from act group by na having count(*)>=8 order by n_active desc limit 16;
select count(*) addrs_ge2_active, sum(c) biz_in_them from (select count(*) c from act group by na having count(*)>=2);
select count(distinct na) from act;
-- excluding mobile
select count(*) addrs_ge2_nonmobile from (select count(*) c from act where classification<>'Mobile Food Unit' group by na having count(*)>=2);
select count(*) addrs_ge5_nonmobile from (select count(*) c from act where classification<>'Mobile Food Unit' group by na having count(*)>=5);
