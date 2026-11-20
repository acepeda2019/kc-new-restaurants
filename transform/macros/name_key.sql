{#- A business name for comparing: upper-case, punctuation to spaces, company suffixes and
    "THE" dropped, spaces collapsed. "The Pizza Co., LLC" -> "PIZZA". -#}
{% macro name_key(name) -%}
trim(regexp_replace(regexp_replace(regexp_replace(upper({{ name }}), '[^A-Z0-9 ]', ' ', 'g'),
    '\b(LLC|L L C|INC|CO|CORP|THE)\b', ' ', 'g'), '\s+', ' ', 'g'))
{%- endmacro %}
