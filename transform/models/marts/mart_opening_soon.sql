-- The app's Opening soon list: King County restaurant licence applications that haven't
-- opened yet (no matched KC inspection) and are younger than max_pending_days, newest first.
-- Never carries the licensee name (test no_licensee_name_in_marts).
with opening_soon as (
    select * from {{ ref('int_opening_soon') }}
),

rules as (
    select privilege, label from {{ ref('lcb_privilege_rules') }} where is_restaurant
),

params as (
    select * from {{ ref('opening_soon_params') }}
),

geocodes as (
    select geocode_key, latitude, longitude from {{ ref('stg_census__geocodes') }}
),

-- "As of" = the newest snapshot, so the cutoff doesn't move with the build machine's clock.
as_of as (
    select max(last_seen_on) as as_of_date from {{ ref('stg_lcb__notices') }}
),

-- A full-bar licence beats beer/wine when a notice carries both.
labels as (
    select
        o.notice_id,
        min(r.label) filter (where r.label = 'full-bar restaurant') as full_bar,
        min(r.label) as any_label
    from opening_soon as o, unnest(o.privileges) as p(privilege)
    join rules as r using (privilege)
    group by o.notice_id
),

pending as (
    select
        o.notice_id,
        o.trade_name,
        o.notice_type,
        o.application_date,
        o.street_address,
        o.city,
        o.zip5,
        coalesce(l.full_bar, l.any_label) as licence_label,
        g.latitude,
        g.longitude,
        a.as_of_date - o.application_date as days_since_application
    from opening_soon as o
    join labels as l using (notice_id)
    left join geocodes as g on g.geocode_key = o.geocode_key
    cross join as_of as a
    cross join params as p
    where o.opened_business_id is null
      and o.application_date >= a.as_of_date - to_days(p.max_pending_days)
)

select
    notice_id,
    trade_name,
    notice_type,
    application_date,
    street_address,
    city,
    zip5,
    latitude,   -- null until the geocoder has matched the address
    longitude,
    licence_label,
    days_since_application,
    case notice_type
        when 'CHANGE OF LOCATION' then 'Moving here: applied for a ' || licence_label || ' licence on '
        else 'Applied for a ' || licence_label || ' licence on '
    end || strftime(application_date, '%b %-d') as why,
    row_number() over (order by application_date desc, notice_id) as rank
from pending
