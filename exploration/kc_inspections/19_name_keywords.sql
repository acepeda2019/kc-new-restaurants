-- Run from data/. Exploratory cafe/dessert name-keyword counts among General Food Services (not a seed).
create table ba as select * from read_json_auto('agg/cur_business_attrs.json');
select count(*) filter (where regexp_matches(upper(name),'COFFEE|CAFE|BAKERY|DONUT|ICE CREAM|BOBA|TEA|CREAMERY|DESSERT|GELATO|BAKE')) cafe_like,
       count(*) filter (where regexp_matches(upper(name),'COFFEE|STARBUCKS|ESPRESSO')) coffee_like from ba where classification='General Food Services';
