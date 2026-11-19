-- The LCB licensee name (sometimes a person) is for matching only: no mart, which is what the
-- app exports, may carry it (owner decision 2026-11-19). Fails if any mart has the column.
-- The refs make it run after the marts are built; add each new mart here (e.g. SAN-48).
-- depends_on: {{ ref('mart_new_openings') }}, {{ ref('mart_metrics') }}, {{ ref('mart_opening_soon') }}
select table_name, column_name
from information_schema.columns
where table_name like 'mart\_%' escape '\'
  and lower(column_name) like '%licensee%'
