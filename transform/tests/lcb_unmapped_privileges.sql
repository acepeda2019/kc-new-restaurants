-- Warn when King County notices carry a privilege the rules seed doesn't know yet: it is
-- treated as "not a restaurant" until someone adds it to seeds/lcb_privilege_rules.csv.
{{ config(severity='warn') }}
select distinct p.privilege
from {{ ref('stg_lcb__notices') }} as n, unnest(n.privileges) as p(privilege)
where n.county = 'KING'
  and p.privilege not in (select privilege from {{ ref('lcb_privilege_rules') }})
