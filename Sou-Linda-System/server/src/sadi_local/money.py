"""Exact cent arithmetic: no float is used in business calculations."""
import re
from decimal import Decimal, InvalidOperation
from .constants import MAX_CENTS

def integer(value, label="Valor", minimum=0, maximum=MAX_CENTS):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{label}: ingresá un entero entre {minimum} y {maximum}.")
    return value

def parse_money(value: str) -> int:
    text = str(value).strip()
    if not re.fullmatch(r"\d+(?:[.,]\d{1,2})?", text):
        raise ValueError("Ingresá un importe como 1250,50, sin separador de miles.")
    try:
        return integer(int(Decimal(text.replace(",", ".")) * 100), "Importe")
    except (InvalidOperation, OverflowError):
        raise ValueError("El importe no es válido.") from None

def format_money(cents: int | None, currency: str = 'ARS') -> str:
    if cents is None:
        return "Sin costo conocido"
    sign = "−" if cents < 0 else ""
    whole, fraction = divmod(abs(cents), 100)
    grouped = f"{whole:,}".replace(",", ".")
    if currency == 'PYG':
        if fraction:
            raise ValueError('El importe en PYG debe representar guaraníes enteros.')
        return f"{sign}₲ {grouped}"
    if currency != 'ARS':
        raise ValueError('Moneda no compatible.')
    return f"{sign}${grouped},{fraction:02d}"

def percent_bps(value: str) -> int:
    result = parse_money(value)
    return integer(result, "Porcentaje", 0, 10_000)

def round_ratio(numerator: int, denominator: int) -> int:
    integer(numerator, "Numerador", 0, 10**50)
    integer(denominator, "Denominador", 1, 10**50)
    return (numerator * 2 + denominator) // (denominator * 2)

def allocate(total: int, weights: list[int]) -> list[int]:
    """Largest-remainder allocation, ties broken by original line order."""
    integer(total, "Total")
    for weight in weights:
        integer(weight, "Peso")
    base = sum(weights)
    if not base:
        if total:
            raise ValueError("No se puede repartir un importe sin base positiva.")
        return [0] * len(weights)
    amounts = [total * weight // base for weight in weights]
    rest = total - sum(amounts)
    order = sorted(range(len(weights)), key=lambda i: (-(total * weights[i] % base), i))
    for index in order[:rest]:
        amounts[index] += 1
    return amounts
