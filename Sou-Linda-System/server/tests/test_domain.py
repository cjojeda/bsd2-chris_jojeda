from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import sqlite3
import pytest

from sadi_local.db import Database
from sadi_local.demo import seed_demo
from sadi_local.money import allocate, format_money, parse_money, round_ratio
from sadi_local.services import SadiService


@pytest.fixture
def service(tmp_path):
    db = Database(tmp_path / 'business.sqlite3')
    yield SadiService(db)
    db.close()


def variant(service, sku='VAL-95-ROJ', stock=10, cost=100, retail=200, **extra):
    data = dict(model='Valentina', category='Conjuntos', sku=sku, size='95', color='Rojo', retail_cents=retail,
                wholesale_cents=150, min_stock=2, initial_qty=stock, initial_unit_cost_cents=cost)
    data.update(extra)
    return service.save_variant(data)


def order(service, v, qty=1, price=200, **extra):
    return service.create_order([dict(variant_id=v, quantity=qty, unit_price_cents=price)], 'Instagram', **extra)


def cash(service):
    return sum(row[0] for row in service.c.execute('SELECT delta_cents FROM cash_entries'))


def test_cpp_discount_fee_shipping_and_packaging(service):
    v = variant(service, stock=10, cost=100000, retail=200000)
    service.receive_stock(v, 10, 1400000)
    o = order(service, v, 2, 200000, discount_kind='percent', discount_value=1000,
              commission_bps=300, shipping_cents=20000, packaging_cents=5000)
    sale = service.get_order(o)
    assert sale['total_cents'] == 360000
    assert sale['cogs_cents'] == 240000
    assert sale['commission_cents'] == 10800
    assert sale['net_profit_cents'] == 84200
    assert service.list_variants()[0]['value_cents'] == 2160000
    assert cash(service) == 324200


def test_receiving_paid_merchandise_affects_cash_not_profit(service):
    v = variant(service, stock=0)
    service.receive_stock(v, 3, 100, paid=True, payment_method='Transferencia')
    assert service.list_variants()[0]['value_cents'] == 100
    assert cash(service) == -100
    assert not service.c.execute('SELECT 1 FROM economic_entries').fetchone()
    o = order(service, v, 3)
    assert service.get_order(o)['cogs_cents'] == 100
    assert service.list_variants()[0]['value_cents'] == 0


def test_reservation_changes_only_available_and_can_cancel(service):
    v = variant(service)
    o = order(service, v, 4, status='reserved')
    inventory = service.list_variants()[0]
    assert (inventory['on_hand'], inventory['reserved'], inventory['available'], inventory['value_cents']) == (10, 4, 6, 1000)
    assert not service.c.execute('SELECT 1 FROM economic_entries').fetchone()
    assert not service.c.execute('SELECT 1 FROM payments').fetchone()
    service.cancel_order(o)
    assert service.list_variants()[0]['available'] == 10
    assert service.get_order(o)['status'] == 'cancelled'
    assert service.get_order(o)['balance_cents'] == 0


def test_cpp_is_frozen_on_completion_not_reservation(service):
    v = variant(service)
    o = order(service, v, 4, status='reserved')
    service.receive_stock(v, 10, 3000)
    service.complete_order(o)
    assert service.get_order(o)['cogs_cents'] == 800
    assert service.list_variants()[0]['value_cents'] == 3200
    assert service.list_variants()[0]['reserved'] == 0
    service.receive_stock(v, 10, 9000)
    assert service.get_order(o)['cogs_cents'] == 800


def test_multi_line_failure_rolls_back_every_write(service):
    v = variant(service)
    unavailable = variant(service, sku='VAL-100', stock=0, size='100')
    before = service.db.snapshot()
    with pytest.raises(ValueError, match='Stock insuficiente'):
        service.create_order([dict(variant_id=v, quantity=2, unit_price_cents=200),
            dict(variant_id=unavailable, quantity=1, unit_price_cents=200)], 'Local', command_id='fail-atomic')
    assert service.db.snapshot() == before


def test_two_connections_cannot_sell_the_last_unit(service):
    v = variant(service, stock=1)
    path = service.db.path
    barrier = Barrier(2)
    def attempt():
        db = Database(path)
        try:
            s = SadiService(db)
            barrier.wait(timeout=5)
            try:
                order(s, v)
                return 'sold'
            except ValueError:
                return 'unavailable'
        finally:
            db.close()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: attempt(), range(2)))
    assert sorted(results) == ['sold', 'unavailable']
    assert service.list_variants()[0]['on_hand'] == 0
    assert len(service.list_orders()) == 1


def test_idempotency_replays_result_and_rejects_other_payload(service):
    v = variant(service)
    first = order(service, v, 2, command_id='checkout-123')
    assert order(service, v, 2, command_id='checkout-123') == first
    assert service.list_variants()[0]['on_hand'] == 8
    with pytest.raises(ValueError, match='otros datos'):
        order(service, v, 3, command_id='checkout-123')
    assert len(service.list_orders()) == 1


def test_credit_partial_collection_refund_and_fee_preservation(service):
    v = variant(service)
    customer = service.save_customer('Lucía', preferred_sizes='95')
    o = order(service, v, 2, payment_method='Crédito', customer_id=customer, commission_bps=300)
    assert cash(service) == 0
    assert service.get_order(o)['balance_cents'] == 400
    service.record_payment(o, 200, 'Tarjeta')
    assert cash(service) == 194
    assert service.get_order(o)['balance_cents'] == 200
    service.cancel_order(o, confirm_return=True)
    assert service.get_order(o)['balance_cents'] == -200
    service.record_refund(o, 200, 'Tarjeta')
    assert service.get_order(o)['balance_cents'] == 0
    assert cash(service) == -6
    assert service.get_order(o)['net_profit_cents'] == -6
    with pytest.raises(ValueError, match='crédito a favor'):
        service.record_refund(o, 1, 'Efectivo')


def test_advance_cancellation_does_not_recognize_revenue(service):
    v = variant(service)
    o = order(service, v, status='reserved', business_date='2026-10-01')
    service.record_payment(o, 100, 'Transferencia', business_date='2026-10-02')
    assert service.get_order(o)['balance_cents'] == 100
    service.cancel_order(o, business_date='2026-10-03')
    assert service.get_order(o)['balance_cents'] == -100
    assert not service.c.execute("SELECT 1 FROM economic_entries WHERE bucket='revenue'").fetchone()
    with pytest.raises(ValueError, match='todavía no existía'):
        service.record_refund(o, 100, 'Transferencia', business_date='2026-10-02')
    service.record_refund(o, 100, 'Transferencia', business_date='2026-10-03')
    assert cash(service) == 0


def test_full_cancellation_requires_physical_confirmation_and_is_idempotent(service):
    v = variant(service)
    o = order(service, v)
    with pytest.raises(ValueError, match='devolución física'):
        service.cancel_order(o)
    service.cancel_order(o, confirm_return=True)
    service.cancel_order(o, confirm_return=True)
    assert service.list_variants()[0]['on_hand'] == 10
    assert len(service.get_order(o)['returns']) == 1
    assert len(service.get_order(o)['payments']) == 1


def test_returns_preserve_original_month_and_historical_cost(service):
    v = variant(service)
    o = order(service, v, 2, business_date='2026-10-01')
    service.receive_stock(v, 8, 1600, business_date='2026-11-01')
    value_before = service.list_variants()[0]['value_cents']
    service.return_order(o, business_date='2026-11-02')
    assert service.list_variants()[0]['value_cents'] == value_before + 200
    oct_revenue = service.c.execute("SELECT SUM(amount_cents) FROM economic_entries WHERE bucket='revenue' AND business_date LIKE '2026-10-%'").fetchone()[0]
    nov_revenue = service.c.execute("SELECT SUM(amount_cents) FROM economic_entries WHERE bucket='revenue' AND business_date LIKE '2026-11-%'").fetchone()[0]
    assert (oct_revenue, nov_revenue) == (400, -400)
    assert service.get_order(o)['completed_date'] == '2026-10-01'


def test_partial_returns_are_cumulative_exact_and_never_exceed_original(service):
    v = variant(service, stock=0)
    service.receive_stock(v, 3, 100)
    o = order(service, v, 3, 101)
    line = service.get_order(o)['items'][0]['id']
    costs = []
    for _ in range(3):
        returned = service.return_order(o, {line: 1})
        costs.append(service._row('returns', returned)['cogs_cents'])
    assert costs == [33, 34, 33]
    assert service.list_variants()[0]['value_cents'] == 100
    assert service.get_order(o)['balance_cents'] == -303
    with pytest.raises(ValueError, match='más unidades'):
        service.return_order(o, {line: 1})


def test_discount_allocation_preserves_cents(service):
    a = variant(service, stock=1)
    b = variant(service, sku='B', stock=1, size='100')
    c = variant(service, sku='C', stock=1, size='105')
    o = service.create_order([dict(variant_id=v, quantity=1, unit_price_cents=100) for v in (a, b, c)], 'Local', discount_value=100)
    lines = service.get_order(o)['items']
    assert [line['discount_cents'] for line in lines] == [34, 33, 33]
    assert sum(line['net_cents'] for line in lines) == 200
    assert sum(line['cogs_cents'] for line in lines) == 300


def test_inventory_loss_cannot_consume_reserved_and_is_not_sale_cogs(service):
    v = variant(service)
    order(service, v, 8, status='reserved')
    with pytest.raises(ValueError, match='reservadas'):
        service.adjust_stock(v, -3, 'Rotura')
    service.adjust_stock(v, -2, 'Rotura')
    assert service.list_variants()[0]['on_hand'] == 8
    assert service.c.execute("SELECT SUM(amount_cents) FROM economic_entries WHERE bucket='inventory_loss'").fetchone()[0] == 200


def test_expense_and_direct_cost_settlement_do_not_duplicate_profit(service):
    expense = service.save_expense('2026-10-01', 'Alquiler', 'Octubre', 1000, 'Transferencia', cost_type='fixed', paid=False)
    assert cash(service) == 0
    service.pay_expense(expense, 'Transferencia', business_date='2026-10-02')
    service.pay_expense(expense, 'Transferencia', business_date='2026-10-02')
    assert cash(service) == -1000
    assert service.c.execute("SELECT SUM(amount_cents) FROM economic_entries WHERE bucket='operating_expense'").fetchone()[0] == 1000
    v = variant(service)
    o = order(service, v, shipping_cents=30, packaging_cents=10, direct_costs_paid=False)
    profit = service.get_order(o)['net_profit_cents']
    before_cash = cash(service)
    service.pay_direct_costs(o, 'Efectivo')
    service.pay_direct_costs(o, 'Efectivo')
    assert cash(service) == before_cash - 40
    assert service.get_order(o)['net_profit_cents'] == profit


@pytest.mark.parametrize('bad', [1.2, True, -1, '100'])
def test_reject_non_integer_money_inputs(service, bad):
    with pytest.raises(ValueError):
        variant(service, retail=bad)
    assert not service.list_variants()


def test_reject_invalid_dates_unknown_channels_and_duplicate_cart(service):
    v = variant(service)
    with pytest.raises(ValueError, match='fecha'):
        order(service, v, business_date='2026-02-30')
    with pytest.raises(ValueError, match='canal'):
        service.create_order([dict(variant_id=v, quantity=1, unit_price_cents=200)], 'Facebook')
    with pytest.raises(ValueError, match='dos veces'):
        service.create_order([dict(variant_id=v, quantity=1, unit_price_cents=200)] * 2, 'Local')
    with pytest.raises(ValueError, match='clienta'):
        order(service, v, payment_method='Crédito')
    assert not service.list_orders()


def test_catalog_uniqueness_is_accent_and_case_insensitive(service):
    variant(service, sku='VAL-Á', color='Rójo')
    with pytest.raises(ValueError, match='SKU'):
        variant(service, sku='val-a', size='100')
    with pytest.raises(ValueError, match='combinación'):
        variant(service, sku='NUEVO', color='rojo')


def test_foreign_keys_and_sql_constraints_are_active(service):
    assert service.c.execute('PRAGMA foreign_keys').fetchone()[0] == 1
    v = variant(service)
    with pytest.raises(sqlite3.IntegrityError):
        service.c.execute('UPDATE inventory SET on_hand=-1 WHERE variant_id=?', (v,))
    with pytest.raises(sqlite3.IntegrityError):
        service.c.execute('UPDATE variants SET product_id=? WHERE id=?', ('missing', v))


def test_nested_transaction_and_draft_autosave(service):
    service.db.save_draft('pos', {'items': [], 'discount': 100})
    assert service.db.load_draft('pos')['discount'] == 100
    with pytest.raises(ValueError):
        with service.db.transaction():
            service.db.set_meta('temporary', 'x')
            raise ValueError('rollback')
    assert service.db.get_meta('temporary') is None
    service.db.delete_draft('pos')
    assert service.db.load_draft('pos') is None


def test_ledger_matches_inventory_after_operations(service):
    v = variant(service)
    service.receive_stock(v, 4, 801)
    o = order(service, v, 3, status='reserved')
    service.complete_order(o)
    line = service.get_order(o)['items'][0]['id']
    service.return_order(o, {line: 1})
    service.adjust_stock(v, -1, 'Merma documentada')
    inv = service.c.execute('SELECT * FROM inventory WHERE variant_id=?', (v,)).fetchone()
    sums = service.c.execute('SELECT SUM(quantity_delta),SUM(reserved_delta),SUM(value_delta_cents) FROM inventory_movements WHERE variant_id=?', (v,)).fetchone()
    assert tuple(sums) == (inv['on_hand'], inv['reserved'], inv['value_cents'])


def test_demo_is_explicit_and_refuses_nonempty_database(service):
    assert service.db.get_meta('demo') is None
    assert seed_demo(service)
    assert service.db.get_meta('demo') == 'true'
    assert len(service.list_variants()) == 8
    assert len(service.list_orders()) == 22
    assert any(o['status'] == 'reserved' for o in service.list_orders())
    with pytest.raises(ValueError, match='vacía'):
        seed_demo(service)


def test_money_parsing_and_rounding():
    assert parse_money('1250,50') == 125050
    assert format_money(-125050) == '−$1.250,50'
    assert round_ratio(1, 2) == 1
    assert allocate(100, [100, 100, 100]) == [34, 33, 33]
    for value in ('1.000,50', 'nan', '-1', '1.234', '', '1e2'):
        with pytest.raises(ValueError):
            parse_money(value)
