-- One row per inspection. Every inspection-level column is repeated on each violation row, so
-- it is grouped on, not picked with any_value: if the source ever disagreed within one
-- inspection, this would return two rows for it and the unique test on inspection_serial_num
-- would fail, instead of a value being chosen silently.
with violations as (
    select * from {{ ref('stg_kc__inspection_violations') }}
)

select
    inspection_serial_num,
    business_id,
    inspection_date,
    inspection_type,
    inspection_result,
    inspection_score,
    is_closed_by_inspection,
    count(violation_description)                                            as violation_count,
    sum(case when violation_type = 'RED' then violation_points else 0 end)  as red_points,
    sum(case when violation_type = 'BLUE' then violation_points else 0 end) as blue_points
from violations
group by all
