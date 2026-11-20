{#- The unit in a KC address, normalised so spellings compare equal: "…, #101B" -> "101B",
    "… STE 114" -> "114", "…, Suite 7" -> "7". Null when there is none. street_clean drops
    the unit (it doesn't move the map point); this keeps it, to tell neighbours in one
    building apart. -#}
{% macro address_unit(address) -%}
nullif(regexp_replace(regexp_replace(
    case
        when strpos(upper({{ address }}), ',') > 0
            then trim(substr(upper({{ address }}), strpos(upper({{ address }}), ',') + 1))
        else regexp_extract(upper(trim({{ address }})), ' ((#|STE\.?|SUITE|UNIT|SPACE|BLDG) ?[^ ]+)$', 1)
    end,
    '^(#|STE\.?|SUITE|UNIT|SPACE|SP\.?|BLDG|NO\.?)\s*', ''), '[^A-Z0-9]', '', 'g'), '')
{%- endmacro %}
