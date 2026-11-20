-- address_unit (macros/address_unit.sql) on real KC spellings. Returns the rows it gets wrong.
with cases(address, expected) as (
    values
        ('100 MAIN ST, 111', '111'),
        ('100 MAIN ST, #111', '111'),
        ('100 MAIN ST, Suite 7', '7'),
        ('100 MAIN ST, E-120', 'E120'),
        ('100 MAIN ST, 5TH FLOOR', '5TH'),
        ('100 MAIN ST, LEVEL 13', '13'),
        ('100 MAIN ST, BUILDING C', 'C'),
        ('100 MAIN ST, UNIT FC3', 'FC3'),
        ('2105 N 45TH ST STE 114', '114'),
        ('2105 N 45TH ST #101B', '101B'),
        ('2105 N 45TH ST SP 4', '4'),
        ('900 STEWART', null),
        ('601 S KING ST 20', null),
        ('2105 N 45TH ST', null)
)

select address, expected, {{ address_unit('address') }} as actual
from cases
where {{ address_unit('address') }} is distinct from expected
