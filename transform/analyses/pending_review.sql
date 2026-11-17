-- "What's pending?": candidates with no Claude answer yet, or one below min_confidence.
-- Decide each by adding a row to seeds/classification_overrides.csv (it always wins).
-- Run: uv run dbt compile -s pending_review, then query the compiled SQL against kcne.duckdb.
select
    c.business_id,
    c.business_name,
    c.address,
    c.city_normalized,
    c.first_inspection_date,
    d.category,
    d.opening_type,
    d.replaces_name,
    d.confidence,
    d.reason
from {{ ref('int_classified_candidates') }} as d
join {{ ref('int_candidates') }} as c using (business_id)
where d.review_status = 'pending'
order by c.first_inspection_date desc
