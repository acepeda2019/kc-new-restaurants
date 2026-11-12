-- Run from data/. Do mobile-unit program_identifier strings hold a serving location?
create table ba as select * from read_json_auto('agg/cur_business_attrs.json');
select count(*) n_mobile, count(program_identifier) with_pi, count(*) filter (where program_identifier like '%@%') pi_with_at, count(*) filter (where upper(program_identifier) like '%VARIOUS%') pi_various,
  count(*) filter (where regexp_matches(upper(name),'KC[0-9]+')) name_has_kc_token from ba where classification='Mobile Food Unit';
select program_identifier from ba where classification='Mobile Food Unit' and program_identifier like '%@%' order by hash(business_id) limit 8;
select count(*) n_mobile_active_12m from ba where classification='Mobile Food Unit' and last_date::date>='2025-11-12';
select count(*) from ba where classification='Mobile Food Unit' and regexp_matches(address,'(?i)^(800 OCCIDENTAL|1250 1ST AVE S|334 1ST AVE N)');
select count(*) filter (where regexp_matches(address,',')) addr_with_comma, count(*) filter (where regexp_matches(address,'(?i)\b(unit|ste|suite)\b|#')) addr_unit_words, count(*) n from (select distinct business_id, address from ba);
select count(*) cities, count(distinct upper(city)) cities_upper from (select distinct city from ba);
select count(*) from ba where city is null;
