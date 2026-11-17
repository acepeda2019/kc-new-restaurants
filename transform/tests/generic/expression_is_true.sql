{% test expression_is_true(model, expression, column_name=none) %}
-- Fails with every row where the expression is not true.
select * from {{ model }} where not ({{ expression }})
{% endtest %}
