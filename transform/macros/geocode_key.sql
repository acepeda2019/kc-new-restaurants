{#- Canonical geocode key rule v1 (ingestion/sources/geocode_key.py), shared by KC and WSLCB
    addresses so both join to the same geocoder responses. Tested against the keys the
    geocoder was actually sent (tests/assert_geocode_key_matches_requests.sql). -#}

{% macro street_clean(address) -%}
trim(regexp_replace(
    trim(regexp_replace(split_part(upper(coalesce({{ address }}, '')), ',', 1), '[ \t\n\r\f\v]+', ' ', 'g')),
    ' (#|STE\.) ?[^ ]+$| (STE|SUITE|UNIT|SPACE|BLDG) [^ ]+$', ''
))
{%- endmacro %}

{% macro zip5(zip_code) -%}
left(trim(coalesce({{ zip_code }}, '')), 5)
{%- endmacro %}

{% macro geocode_key(street_clean_expr, zip5_expr) -%}
case when {{ street_clean_expr }} <> '' then md5({{ street_clean_expr }} || '|' || {{ zip5_expr }}) end
{%- endmacro %}
