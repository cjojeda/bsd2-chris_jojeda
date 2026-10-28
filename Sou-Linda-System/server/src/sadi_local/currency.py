"""Explicit business currency and cash precision without changing stored scale.

The schema's historical ``*_cents`` identifiers mean hundredths of the business
currency. New web businesses use PYG and accept whole guaranies (quantum 100).
Databases created before currency metadata existed keep ARS; changing a symbol
must never act as a foreign-exchange conversion of real historical records.
"""
from .money import allocate, integer, round_ratio

SUPPORTED_CURRENCIES = ('PYG', 'ARS')
BUSINESS_TABLES = ('products', 'variants', 'customers', 'orders', 'expenses',
                   'purchases', 'cash_entries', 'economic_entries', 'drafts', 'cash_closings')


def currency_code(db):
    # Pure report snapshots used by integrations predating currency metadata
    # follow the legacy policy until an explicit business currency is provided.
    code = db.get_meta('currency', 'ARS') if hasattr(db, 'get_meta') else 'ARS'
    if code not in SUPPORTED_CURRENCIES:
        raise ValueError('La moneda de esta base no es compatible. No se convirtieron sus importes.')
    return code


def initialize_business_currency(db):
    """Initialize only metadata; historical monetary values remain untouched."""
    present = db.get_meta('currency')
    if present is not None:
        return currency_code(db)
    with db.transaction():
        populated = any(db.connection.execute(f'SELECT 1 FROM "{table}" LIMIT 1').fetchone()
                        for table in BUSINESS_TABLES)
        code = 'ARS' if populated else 'PYG'
        db.set_meta('currency', code)
    return code


def money_quantum(db):
    return 100 if currency_code(db) == 'PYG' else 1


def validate_amount(db, value, label='Importe', minimum=0):
    result = integer(value, label, minimum)
    if result % money_quantum(db):
        raise ValueError(f'{label}: ingresá guaraníes enteros, sin decimales.')
    return result


def round_money_ratio(db, numerator, denominator):
    quantum = money_quantum(db)
    return round_ratio(numerator, denominator * quantum) * quantum


def allocate_money(db, total, weights):
    quantum = money_quantum(db)
    validate_amount(db, total, 'Importe a repartir')
    return [part * quantum for part in allocate(total // quantum, weights)]
