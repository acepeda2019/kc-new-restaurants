-- dbt's SQL version of the geocode key must match the Python rule the geocoder used.
-- Returns KC addresses (non-mobile, non-empty street) whose dbt key was never sent to the geocoder.
select e.business_id, e.address, e.zip5, e.geocode_key
from {{ ref('int_establishments') }} as e
where e.classification <> 'Mobile Food Unit'
  and e.geocode_key is not null
  and e.geocode_key not in (select geocode_key from {{ source('census', 'geocoder_requests') }})
