"""Semantic report tests: periods, debt/cash separation and exact allocation."""
from copy import deepcopy

import pytest

from sadi_local.db import Database
from sadi_local.reports import close_cash, daily_report, monthly_report
from sadi_local.services import SadiService



class SnapshotDatabase:
    def __init__(self, **tables):
        self.tables = tables

    def snapshot(self):
        return deepcopy(self.tables)


def event(bucket, amount, day="2026-10-20", channel="Instagram", order_id="sale"):
    return {"bucket": bucket, "amount_cents": amount, "business_date": day,
            "channel": channel, "order_id": order_id, "reference": "test"}


def order(identifier="sale", **changes):
    result = {"id": identifier, "business_date": "2026-10-20", "completed_date": "2026-10-20",
              "status": "completed", "total_cents": 360000, "cogs_cents": 240000,
              "discount_cents": 40000, "channel": "Instagram", "terms": "immediate"}
    result.update(changes)
    return result


@pytest.fixture
def database(tmp_path):
    db = Database(tmp_path / "reports.sqlite3")
    yield db
    db.close()


def test_monthly_profit_is_net_after_discount_costs_and_operating_expenses():
    db = SnapshotDatabase(orders=[order()], economic_entries=[
        event("revenue", 360000), event("cogs", 240000), event("commission", 10800),
        event("shipping", 20000), event("packaging", 5000),
        event("operating_expense", 20000, channel=None, order_id=None)], payments=[])
    report = monthly_report(db, "2026-10")
    assert report["revenue_cents"] == 360000
    assert report["gross_profit_cents"] == 120000
    assert report["net_profit_cents"] == 64200
    assert report["average_ticket_cents"] == 360000
    assert report["discount_cents"] == 40000
    assert report["channels"][0]["profit_cents"] == 84200
    assert report["unallocated_expense_cents"] == 20000
    assert sum(row["profit_cents"] for row in report["channels"]) - report["unallocated_expense_cents"] == report["net_profit_cents"]


def test_return_in_november_never_rewrites_october_sale_or_its_ticket():
    cancelled = order(status="cancelled")
    db = SnapshotDatabase(orders=[cancelled], returns=[{"order_id": "sale", "business_date": "2026-11-03", "revenue_cents": 360000, "cogs_cents": 240000}],
        economic_entries=[event("revenue", 360000), event("cogs", 240000), event("commission", 10800),
                          event("revenue", -360000, "2026-11-03"), event("cogs", -240000, "2026-11-03")])
    october = monthly_report(db, "2026-10")
    november = monthly_report(db, "2026-11")
    assert october["revenue_cents"] == 360000
    assert october["sales_count"] == 1
    assert october["net_profit_cents"] == 109200
    assert november["revenue_cents"] == -360000
    assert november["cogs_cents"] == -240000
    assert november["net_profit_cents"] == -120000
    assert november["sales_count"] == 0
    assert november["average_ticket_cents"] == 0
    assert november["previous_revenue_cents"] == 360000


@pytest.mark.parametrize("shared", [5, -5])
def test_shared_expense_allocation_preserves_signed_cents_and_reconciles(shared):
    db = SnapshotDatabase(economic_entries=[
        event("revenue", 1, channel="Instagram"), event("revenue", 1, channel="WhatsApp"),
        event("revenue", 1, channel="TikTok"), event("operating_expense", shared, channel=None, order_id=None)])
    result = monthly_report(db, "2026-10", allocate_shared=True)
    rows = {row["channel"]: row for row in result["channels"]}
    sign = 1 if shared > 0 else -1
    assert rows["Instagram"]["shared_allocated_cents"] == 2 * sign
    assert rows["WhatsApp"]["shared_allocated_cents"] == 2 * sign
    assert rows["TikTok"]["shared_allocated_cents"] == sign
    assert rows["Local"]["shared_allocated_cents"] == 0
    assert result["unallocated_expense_cents"] == 0
    assert sum(row["profit_cents"] for row in rows.values()) == result["net_profit_cents"]


def test_negative_revenue_is_not_used_as_an_allocation_weight():
    db = SnapshotDatabase(economic_entries=[event("revenue", -100, channel="Instagram"),
        event("revenue", 200, channel="WhatsApp"), event("operating_expense", 17, channel=None, order_id=None)])
    rows = {row["channel"]: row for row in monthly_report(db, "2026-10", True)["channels"]}
    assert rows["Instagram"]["shared_allocated_cents"] == 0
    assert rows["WhatsApp"]["shared_allocated_cents"] == 17


def test_no_positive_revenue_leaves_shared_costs_visible_unallocated():
    db = SnapshotDatabase(economic_entries=[event("revenue", -100), event("operating_expense", 17, channel=None, order_id=None)])
    report = monthly_report(db, "2026-10", True)
    assert report["unallocated_expense_cents"] == 17
    assert sum(row["shared_allocated_cents"] for row in report["channels"]) == 0


def test_missing_historical_cogs_never_becomes_fictitious_profit():
    db = SnapshotDatabase(orders=[order(cogs_cents=None)], economic_entries=[event("revenue", 360000)])
    report = monthly_report(db, "2026-10")
    assert report["incomplete_cost_count"] == 1
    assert report["net_profit_cents"] is None
    assert report["gross_profit_cents"] is None
    assert next(row for row in report["channels"] if row["channel"] == "Instagram")["profit_cents"] is None


def test_debt_customer_credit_and_advances_are_separate():
    orders = [order("debt", total_cents=10000),
        order("credit", total_cents=10000, status="cancelled"),
        order("advance", completed_date=None, status="reserved", total_cents=5000),
        order("cancelled_advance", completed_date=None, status="cancelled", total_cents=2000)]
    payments = [{"order_id": key, "kind": "receipt", "amount_cents": amount} for key, amount in
                (("debt", 4000), ("credit", 4000), ("advance", 1000), ("cancelled_advance", 500))]
    returns = [{"order_id": "debt", "revenue_cents": 3000, "cogs_cents": 0, "business_date": "2026-10-21"},
               {"order_id": "credit", "revenue_cents": 8000, "cogs_cents": 0, "business_date": "2026-10-21"}]
    report = monthly_report(SnapshotDatabase(orders=orders, payments=payments, returns=returns), "2026-10")
    assert report["outstanding_cents"] == 3000
    assert report["customer_credit_cents"] == 2500
    assert report["advances_cents"] == 1000


def test_daily_cash_uses_actual_money_not_the_credit_sale_total():
    cash = [{"business_date": "2026-10-20", "method": method, "delta_cents": amount, "sequence": index}
            for index, (method, amount) in enumerate((("Efectivo", 10000), ("Efectivo", -2000), ("Transferencia", 5000), ("Tarjeta", -300)), 1)]
    report = daily_report(SnapshotDatabase(cash_entries=cash, orders=[order(terms="credit", total_cents=50000)]), "2026-10-20", 1000)
    assert report["expected_cash_cents"] == 9000
    assert report["receipts_cents"] == 15000
    assert report["expenses_cents"] == 2300
    assert report["credit_sales_cents"] == 50000


def test_service_sale_and_unpaid_expense_reconcile_reports(database):
    service = SadiService(database)
    variant_id = service.save_variant({"model": "Valentina", "category": "Conjuntos", "sku": "VAL-95-R",
        "size": "95", "color": "Rojo", "retail_cents": 200000, "wholesale_cents": 180000,
        "min_stock": 1, "initial_qty": 10, "initial_unit_cost_cents": 120000})
    service.create_order([{"variant_id": variant_id, "quantity": 2, "unit_price_cents": 200000}], "Instagram",
        discount_kind="percent", discount_value=1000, commission_bps=300, shipping_cents=20000,
        packaging_cents=5000, payment_method="Transferencia", business_date="2026-10-20")
    service.save_expense("2026-10-20", "Publicidad", "Campaña todavía sin pagar", 20000, "Transferencia", paid=False)
    month = monthly_report(database, "2026-10")
    day = daily_report(database, "2026-10-20", 30000)
    assert month["net_profit_cents"] == 64200
    assert day["expected_cash_cents"] == 5000
    assert day["receipts_cents"] == 360000
    assert day["expenses_cents"] == 35800


def test_cash_closing_is_explicit_and_late_entries_do_not_rewrite_it(database):
    def insert_cash(identifier, sequence, amount):
        database.connection.execute("INSERT INTO cash_entries VALUES(?,?,?,?,?,?,?,?,?)",
            (identifier, sequence, "2026-10-20", "Efectivo", amount, "manual", None, identifier, "test"))
    insert_cash("first", 1, 10000)
    first = close_cash(database, "2026-10-20", 1000, 10900, "Faltan cien centavos")
    assert first["expected_cents"] == 11000
    assert first["difference_cents"] == -100
    with pytest.raises(ValueError, match="rectificación"):
        close_cash(database, "2026-10-20", 1000, 11000)
    insert_cash("late", 2, 2000)
    report = daily_report(database, "2026-10-20", 1000)
    assert report["expected_cash_cents"] == 13000
    assert report["closing"]["expected_cents"] == 11000
    assert report["late_movements_count"] == 1
    revised = close_cash(database, "2026-10-20", 1000, 13000, "Cobro tardío conciliado", allow_revision=True)
    assert revised["revision_number"] == 2
    assert len(database.snapshot()["cash_closings"]) == 2


@pytest.mark.parametrize("month", ["2026-13", "2026-2", "26-10", "0000-10", None])
def test_invalid_month_is_rejected(month):
    with pytest.raises(ValueError):
        monthly_report(SnapshotDatabase(), month)


@pytest.mark.parametrize("day", ["2026-02-30", "2026-1-01", "2026-13-01"])
def test_invalid_daily_date_is_rejected(day):
    with pytest.raises(ValueError):
        daily_report(SnapshotDatabase(), day)
