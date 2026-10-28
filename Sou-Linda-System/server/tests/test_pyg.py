"""Guarani precision and explicit compatibility with pre-currency databases."""
import pytest
from fastapi.testclient import TestClient

from sadi_local.currency import (allocate_money, currency_code,
    initialize_business_currency, money_quantum, round_money_ratio, validate_amount)
from sadi_local.db import Database
from sadi_local.money import format_money
from sadi_local.reports import close_cash, daily_report, monthly_report
from sadi_local.services import SadiService
from sadi_local.web import create_app
from sadi_local.web_bridge import normalize_sale


@pytest.fixture
def service(tmp_path):
    db = Database(tmp_path / 'pyg.sqlite3')
    assert initialize_business_currency(db) == 'PYG'
    yield SadiService(db)
    db.close()


def variant(service, *, price=5_000_000, qty=6, cost=3_000_000, sku='PYG-95-R'):
    return service.save_variant(dict(model=f'Valentina {sku}', category='Conjuntos', sku=sku,
        size='95', color='Rojo', retail_cents=price, wholesale_cents=price,
        min_stock=1, initial_qty=qty, initial_unit_cost_cents=cost))


def order(service, item, *, qty=1, price=5_000_000, **kwargs):
    return service.create_order([dict(variant_id=item, quantity=qty, unit_price_cents=price)],
                                'Instagram', business_date='2026-10-28', **kwargs)


def test_new_business_pyg_but_populated_legacy_database_is_not_relabelled(tmp_path):
    empty = Database(tmp_path / 'new.sqlite3')
    assert initialize_business_currency(empty) == 'PYG'
    assert currency_code(empty) == 'PYG' and money_quantum(empty) == 100
    empty.close()
    legacy = Database(tmp_path / 'legacy.sqlite3')
    existing = variant(SadiService(legacy), price=101, cost=33)
    before = legacy.connection.execute('SELECT retail_cents FROM variants WHERE id=?', (existing,)).fetchone()[0]
    assert initialize_business_currency(legacy) == 'ARS'
    assert currency_code(legacy) == 'ARS' and money_quantum(legacy) == 1
    assert legacy.connection.execute('SELECT retail_cents FROM variants WHERE id=?', (existing,)).fetchone()[0] == before
    assert initialize_business_currency(legacy) == 'ARS'
    legacy.close()


def test_rounding_half_guarani_and_allocation_conserve_guaranies(service):
    assert round_money_ratio(service.db, 150, 1) == 200
    assert round_money_ratio(service.db, 149, 1) == 100
    assert allocate_money(service.db, 500, [1, 1, 1]) == [200, 200, 100]
    for value in (1, 10, 99, 101, 10050):
        with pytest.raises(ValueError, match='guaraníes enteros'):
            validate_amount(service.db, value)
    assert format_money(5_000_000, 'PYG') == '₲ 50.000'
    assert format_money(-125000, 'PYG') == '−₲ 1.250'
    with pytest.raises(ValueError):
        format_money(125050, 'PYG')


def test_percent_discount_commission_and_cpp_use_whole_pyg(service):
    item = variant(service)
    identifier = order(service, item, discount_kind='percent', discount_value=1250,
        commission_bps=300, shipping_cents=500_000, packaging_cents=150_000)
    sale = service.get_order(identifier)
    assert sale['discount_cents'] == 625_000  # Gs 6.250, not a reduction in product cost.
    assert sale['total_cents'] == 4_375_000
    assert sale['cogs_cents'] == 3_000_000
    assert sale['commission_cents'] == 131_300  # Gs 1.312,5 rounds to Gs 1.313.
    assert sale['net_profit_cents'] == 593_700
    assert monthly_report(service.db, '2026-10')['net_profit_cents'] == 593_700
    assert all(row['amount_cents'] % 100 == 0 for row in service.db.snapshot()['economic_entries'])
    assert all(row['delta_cents'] % 100 == 0 for row in service.db.snapshot()['cash_entries'])


def test_cpp_last_unit_and_partial_returns_restore_full_inventory_value(service):
    item = variant(service, price=1000, qty=0, cost=0)
    service.receive_stock(item, 3, 1000, business_date='2026-10-28')  # Gs 10 over three units.
    identifier = order(service, item, qty=3, price=1000)
    sale = service.get_order(identifier)
    line = sale['items'][0]
    assert sale['cogs_cents'] == 1000
    amounts = []
    for _ in range(3):
        returned = service.return_order(identifier, {line['id']: 1}, business_date='2026-10-28')
        amounts.append(service._row('returns', returned)['cogs_cents'])
    assert amounts == [300, 400, 300]
    assert service.list_variants()[0]['value_cents'] == 1000
    for _ in range(3):
        order(service, item, qty=1, price=1000)
    assert service.list_variants()[0]['value_cents'] == 0
    assert sum(row[0] for row in service.c.execute("SELECT amount_cents FROM economic_entries WHERE bucket='cogs'")) == 1000


def test_display_cpp_and_unit_cost_are_whole_but_total_cost_stays_authoritative(service):
    item = variant(service, price=10000, qty=0, cost=0)
    service.receive_stock(item, 2, 10100)
    assert service.list_variants()[0]['cpp_cents'] == 5100
    identifier = order(service, item, qty=2, price=10000)
    snapshot = normalize_sale(service, identifier)
    assert snapshot['items'][0]['unitCost'] == 5100
    assert snapshot['items'][0]['costTotal'] == 10100
    assert snapshot['costTotal'] == 10100


def test_discount_allocation_and_partial_refunds_do_not_leave_hidden_fraction(service):
    first = variant(service, price=100, cost=0, sku='A')
    second = variant(service, price=100, cost=0, sku='B')
    identifier = service.create_order([dict(variant_id=item, quantity=1, unit_price_cents=100) for item in (first, second)],
        'WhatsApp', discount_kind='percent', discount_value=2500, business_date='2026-10-28')
    sale = service.get_order(identifier)
    assert sale['discount_cents'] == 100
    assert sorted(row['discount_cents'] for row in sale['items']) == [0, 100]
    service.return_order(identifier, business_date='2026-10-28')
    service.record_refund(identifier, 100, 'Efectivo', business_date='2026-10-28')
    assert service.get_order(identifier)['balance_cents'] == 0


def test_pyg_report_shared_costs_and_ticket_rounding_reconcile(service):
    item = variant(service, price=100, cost=0)
    for price, channel in ((100, 'Instagram'), (200, 'WhatsApp')):
        service.create_order([dict(variant_id=item, quantity=1, unit_price_cents=price)], channel,
                             business_date='2026-10-28')
    service.save_expense('2026-10-28', 'Publicidad', 'Compartido', 100, 'Efectivo')
    report = monthly_report(service.db, '2026-10', allocate_shared=True)
    assert report['average_ticket_cents'] == 200
    assert sum(row['shared_allocated_cents'] for row in report['channels']) == 100
    assert all(row['shared_allocated_cents'] % 100 == 0 for row in report['channels'])
    assert sum(row['profit_cents'] for row in report['channels']) == report['net_profit_cents']


def test_fractional_pyg_input_rolls_back_all_business_boundaries(service):
    item = variant(service)
    operations = [
        lambda: variant(service, price=101, sku='BAD'),
        lambda: service.receive_stock(item, 1, 101),
        lambda: service.adjust_stock(item, 1, 'Ajuste', total_cost_cents=101),
        lambda: order(service, item, price=101),
        lambda: order(service, item, discount_value=1),
        lambda: order(service, item, shipping_cents=1),
        lambda: order(service, item, packaging_cents=1),
        lambda: service.save_expense('2026-10-28', 'Otros', 'Decimal', 1, 'Efectivo'),
        lambda: close_cash(service.db, '2026-10-28', 1, 100),
        lambda: close_cash(service.db, '2026-10-28', 0, 101),
        lambda: daily_report(service.db, '2026-10-28', 1),
    ]
    for operation in operations:
        before = service.db.snapshot()
        with pytest.raises(ValueError, match='guaraníes enteros'):
            operation()
        assert service.db.snapshot() == before


def test_pyg_credit_payment_and_refund_reject_fractional_value(service):
    item = variant(service)
    customer = service.save_customer('Clienta', phone='+595971000000')
    identifier = order(service, item, customer_id=customer, payment_method='Crédito')
    with pytest.raises(ValueError, match='guaraníes enteros'):
        service.record_payment(identifier, 1, 'Efectivo', business_date='2026-10-28')
    service.record_payment(identifier, 5_000_000, 'Efectivo', business_date='2026-10-28')
    service.return_order(identifier, business_date='2026-10-28')
    with pytest.raises(ValueError, match='guaraníes enteros'):
        service.record_refund(identifier, 1, 'Efectivo', business_date='2026-10-28')
    service.record_refund(identifier, 5_000_000, 'Efectivo', business_date='2026-10-28')
    assert service.get_order(identifier)['balance_cents'] == 0


def test_http_reports_tell_mobile_and_notebook_the_business_currency(tmp_path):
    app = create_app(tmp_path / 'new.sqlite3', allow_mobile=True, report_addresses=['http://192.168.1.4:8765'])
    with TestClient(app, base_url='http://localhost:8765', client=('127.0.0.1', 12)) as client:
        session = client.get('/api/session').json()
        assert client.get('/api/reports/monthly?month=2026-10').json()['currency'] == 'PYG'
        assert client.get('/api/reports/daily?date=2026-10-28').json()['currency'] == 'PYG'
        paired = client.post('/api/mobile/pair', json={}, headers={'X-SADI-CSRF': session['csrfToken']}).json()
        report = client.get('/api/mobile/reports?month=2026-10', headers={'Authorization': 'Bearer ' + paired['token']})
        assert report.status_code == 200 and report.json()['currency'] == 'PYG'


def test_http_opening_legacy_database_does_not_exchange_or_reinterpret_it(tmp_path):
    path = tmp_path / 'legacy.sqlite3'
    db = Database(path)
    item = variant(SadiService(db), price=101, cost=33)
    db.close()
    with TestClient(create_app(path), base_url='http://localhost', client=('127.0.0.1', 12)) as client:
        client.get('/api/session')
        snapshot = client.get('/api/snapshot').json()
        assert next(row['value'] for row in snapshot['settings'] if row['key'] == 'currency') == 'ARS'
        assert next(row['retailPrice'] for row in snapshot['variants'] if row['id'] == item) == 101
        assert client.get('/api/reports/monthly?month=2026-10').json()['currency'] == 'ARS'
