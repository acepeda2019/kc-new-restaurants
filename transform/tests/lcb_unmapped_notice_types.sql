-- Warn when a notice type appears that seeds/lcb_notice_types.csv doesn't classify yet.
{{ config(severity='warn') }}
select distinct notice_type
from {{ ref('stg_lcb__notices') }}
where notice_type not in (select notice_type from {{ ref('lcb_notice_types') }})
