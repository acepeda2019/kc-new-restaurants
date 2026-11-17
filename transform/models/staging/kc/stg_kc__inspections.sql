with violations as (
    select * from {{ ref('stg_kc__inspection_violations') }}
)

select
    inspection_serial_num,
    any_value(business_id)                                              as business_id,
    any_value(inspection_date)                                          as inspection_date,
    any_value(inspection_type)                                          as inspection_type,
    any_value(inspection_result)                                        as inspection_result,
    any_value(inspection_score)                                         as inspection_score,
    bool_or(is_closed_by_inspection)                                    as is_closed_by_inspection,
    count(violation_description)                                        as violation_count,
    coalesce(sum(violation_points) filter (where violation_type = 'RED'), 0) as red_points
from violations
group by inspection_serial_num
