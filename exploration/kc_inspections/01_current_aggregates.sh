#!/usr/bin/env bash
# Full-dataset aggregate queries against the CURRENT dataset (r878-4sxa).
# Output: data/agg/cur_*.json. Each file name is cited in the source card.
source "$(dirname "$0")/lib.sh"
D=r878-4sxa
L='$limit=50000'

# Totals, date range, key cardinalities
soql $D cur_totals --data-urlencode '$select=count(*) as n_rows, min(inspection_date) as min_date, max(inspection_date) as max_date, count(distinct business_id) as n_business, count(distinct inspection_serial_num) as n_serial, count(distinct name) as n_name, count(distinct address) as n_address, count(distinct parcel_number) as n_parcel'
# Null counts per column (count(col) counts non-null)
soql $D cur_nonnull --data-urlencode '$select=count(*) as n, count(name) as name, count(program_identifier) as program_identifier, count(inspection_date) as inspection_date, count(classification) as classification, count(address) as address, count(city) as city, count(zip_code) as zip_code, count(inspection_type) as inspection_type, count(inspection_score) as inspection_score, count(inspection_result) as inspection_result, count(inspection_closed_business) as inspection_closed_business, count(seating_range) as seating_range, count(risk_category) as risk_category, count(violation_type) as violation_type, count(violation_description) as violation_description, count(violation_points) as violation_points, count(grade) as grade, count(parcel_number) as parcel_number, count(business_id) as business_id, count(inspection_serial_num) as inspection_serial_num'
# System fields
soql $D cur_system_fields --data-urlencode '$select=:updated_at, :created_at, count(*) as n' --data-urlencode '$group=:updated_at, :created_at' --data-urlencode "$L"
# Distinct values of classification-type fields
for col in classification inspection_type seating_range risk_category inspection_result inspection_closed_business grade violation_type city program_identifier; do
  soql $D cur_values_$col --data-urlencode "\$select=$col, count(*) as n_rows, count(distinct business_id) as n_business, count(distinct inspection_serial_num) as n_inspections" --data-urlencode "\$group=$col" --data-urlencode '$order=n_rows desc' --data-urlencode "$L"
done
soql $D cur_values_class_seat_risk --data-urlencode '$select=classification, seating_range, risk_category, count(distinct business_id) as n_business, count(*) as n_rows' --data-urlencode '$group=classification, seating_range, risk_category' --data-urlencode '$order=n_business desc' --data-urlencode "$L"
soql $D cur_values_type_result --data-urlencode '$select=inspection_type, inspection_result, count(distinct inspection_serial_num) as n_inspections, sum(violation_points) as pts' --data-urlencode '$group=inspection_type, inspection_result' --data-urlencode '$order=n_inspections desc' --data-urlencode "$L"
# Rows per month (cadence, coverage)
soql $D cur_rows_by_month --data-urlencode '$select=date_trunc_ym(inspection_date) as month, count(*) as n_rows, count(distinct inspection_serial_num) as n_inspections' --data-urlencode '$group=month' --data-urlencode '$order=month' --data-urlencode "$L"
# Most recent dates (lag check)
soql $D cur_recent_dates --data-urlencode '$select=inspection_date, count(distinct inspection_serial_num) as n_inspections' --data-urlencode '$group=inspection_date' --data-urlencode '$order=inspection_date desc' --data-urlencode '$limit=40'
# Inspection grain: one row per serial number with its attributes (keys + type only, no violation text)
for off in 0 50000; do
  soql $D cur_inspections_$off --data-urlencode '$select=inspection_serial_num, business_id, inspection_date, inspection_type, inspection_result, inspection_score, inspection_closed_business, count(*) as n_rows, count(violation_description) as n_violations, sum(violation_points) as sum_points' --data-urlencode '$group=inspection_serial_num, business_id, inspection_date, inspection_type, inspection_result, inspection_score, inspection_closed_business' --data-urlencode '$order=inspection_serial_num, business_id, inspection_date' --data-urlencode "$L" --data-urlencode "\$offset=$off"
done
# Business grain: attribute combinations per business_id (detects attribute drift within an ID)
soql $D cur_business_attrs --data-urlencode '$select=business_id, name, program_identifier, address, city, zip_code, classification, seating_range, risk_category, parcel_number, min(inspection_date) as first_date, max(inspection_date) as last_date, count(distinct inspection_serial_num) as n_inspections' --data-urlencode '$group=business_id, name, program_identifier, address, city, zip_code, classification, seating_range, risk_category, parcel_number' --data-urlencode '$order=business_id' --data-urlencode "$L"
# Violation-level duplicate check: (serial, violation_description) combos with >1 row
soql $D cur_dup_violations --data-urlencode '$select=inspection_serial_num, violation_type, violation_description, count(*) as n' --data-urlencode '$group=inspection_serial_num, violation_type, violation_description' --data-urlencode '$having=n > 1' --data-urlencode "$L"
