-- King County licence notices that signal a restaurant about to open: a counted notice type
-- (seed lcb_notice_types) with at least one restaurant privilege (seed lcb_privilege_rules).
-- Matching to KC inspections (has it opened?) and drop-off come in SAN-47.
with notices as (
    select * from {{ ref('stg_lcb__notices') }}
),

notice_types as (
    select notice_type from {{ ref('lcb_notice_types') }} where counts_as_opening
),

restaurant_privileges as (
    select privilege from {{ ref('lcb_privilege_rules') }} where is_restaurant
),

restaurant_notices as (
    select distinct n.notice_id
    from notices as n, unnest(n.privileges) as p(privilege)
    join restaurant_privileges using (privilege)
)

select
    n.notice_id,
    n.license_number,
    n.notice_type,
    n.application_date,
    n.posted_date,
    n.trade_name,
    n.ubi,
    n.street_address,
    n.city,
    n.zip5,
    n.privileges,
    n.first_seen_on,
    n.last_seen_on
from notices as n
join notice_types using (notice_type)
join restaurant_notices using (notice_id)
where n.county = 'KING'
