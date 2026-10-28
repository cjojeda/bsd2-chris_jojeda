"""Event-based financial reports and immutable daily cash snapshots.

Revenue/cost entries are recognized by their business dates. A later return does
not erase the original period. Cash is reported independently from accruals.
"""
from calendar import monthrange
from datetime import date, datetime, timezone
import re
from uuid import uuid4

from .constants import CHANNELS, PAYMENT_METHODS, MAX_CENTS
from .money import allocate, integer, round_ratio


def _date(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("La fecha debe tener formato AAAA-MM-DD.")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise ValueError("La fecha no existe en el calendario.") from None
    return parsed.isoformat()


def _month(value: str) -> tuple[int, int]:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}", value):
        raise ValueError("El mes debe tener formato AAAA-MM.")
    _date(value + "-01")
    return int(value[:4]), int(value[5:])


def _previous_month(year: int, month: int) -> str:
    if year == 1 and month == 1:
        return "0000-12"
    return f"{year - 1 if month == 1 else year:04d}-{12 if month == 1 else month - 1:02d}"


def _order_balances(data: dict) -> dict:
    payments: dict[str, int] = {}
    credits: dict[str, int] = {}
    for payment in data.get("payments", []):
        sign = 1 if payment["kind"] == "receipt" else -1
        payments[payment["order_id"]] = payments.get(payment["order_id"], 0) + sign * payment["amount_cents"]
    for returned in data.get("returns", []):
        credits[returned["order_id"]] = credits.get(returned["order_id"], 0) + returned["revenue_cents"]
    outstanding = customer_credit = advances = 0
    for order in data.get("orders", []):
        paid = payments.get(order["id"], 0)
        if order.get("completed_date"):
            balance = order["total_cents"] - credits.get(order["id"], 0) - paid
            outstanding += max(balance, 0)
            customer_credit += max(-balance, 0)
        elif order["status"] == "cancelled":
            customer_credit += max(paid, 0)
        else:
            advances += max(paid, 0)
    return {"outstanding_cents": outstanding, "customer_credit_cents": customer_credit, "advances_cents": advances}


def monthly_report(db, month: str, allocate_shared: bool = False) -> dict:
    """Return a consistent monthly accrual report in integer cents.

    Shared expenses include unassigned operating costs and inventory losses.
    Allocation uses positive channel revenue weights and preserves signed cents.
    Unknown historical COGS makes real profit unavailable, never fictitious zero.
    """
    year, number = _month(month)
    data = db.snapshot()
    all_events = data.get("economic_entries", [])
    events = [entry for entry in all_events if entry["business_date"].startswith(month + "-")]
    orders_by_id = {order["id"]: order for order in data.get("orders", [])}
    totals = {bucket: 0 for bucket in ("revenue", "cogs", "commission", "shipping", "packaging", "operating_expense", "inventory_loss")}
    rows = {channel: {"channel": channel, "revenue_cents": 0, "cogs_cents": 0, "commission_cents": 0,
                      "shipping_cents": 0, "packaging_cents": 0, "attributed_expense_cents": 0,
                      "contribution_cents": 0, "shared_allocated_cents": 0, "profit_cents": 0,
                      "incomplete_cost_count": 0, "sales_count": 0}
            for channel in CHANNELS}
    daily = {f"{month}-{day:02d}": 0 for day in range(1, monthrange(year, number)[1] + 1)}
    unassigned = 0
    for event in events:
        bucket = event["bucket"]
        amount = event["amount_cents"]
        if bucket not in totals:
            raise ValueError(f"Concepto financiero desconocido: {bucket}.")
        totals[bucket] += amount
        if bucket == "revenue":
            daily[event["business_date"]] += amount
        channel = event.get("channel")
        if channel is None and event.get("order_id"):
            channel = orders_by_id.get(event["order_id"], {}).get("channel")
        if channel in rows:
            if bucket in ("operating_expense", "inventory_loss"):
                rows[channel]["attributed_expense_cents"] += amount
            else:
                rows[channel][f"{bucket}_cents"] += amount
        elif bucket != "revenue":
            # Inventory losses and shared overhead are intentionally unassigned.
            unassigned += amount

    new_orders = [order for order in data.get("orders", []) if (order.get("completed_date") or "").startswith(month + "-")]
    missing = {order["id"] for order in new_orders if order.get("cogs_cents") is None}
    for returned in data.get("returns", []):
        if returned["business_date"].startswith(month + "-") and returned.get("cogs_cents") is None:
            missing.add(returned["order_id"])
    for order in new_orders:
        channel = order["channel"]
        if channel in rows:
            rows[channel]["sales_count"] += 1
    for order_id in missing:
        channel = orders_by_id.get(order_id, {}).get("channel")
        if channel in rows:
            rows[channel]["incomplete_cost_count"] += 1

    assigned = [0] * len(CHANNELS)
    if allocate_shared and unassigned:
        weights = [max(rows[channel]["revenue_cents"], 0) for channel in CHANNELS]
        if sum(weights):
            sign = 1 if unassigned > 0 else -1
            assigned = [sign * value for value in allocate(abs(unassigned), weights)]
    for index, channel in enumerate(CHANNELS):
        row = rows[channel]
        contribution = row["revenue_cents"] - row["cogs_cents"] - row["commission_cents"] - row["shipping_cents"] - row["packaging_cents"]
        row["shared_allocated_cents"] = assigned[index]
        row["contribution_cents"] = None if row["incomplete_cost_count"] else contribution
        row["profit_cents"] = None if row["incomplete_cost_count"] else contribution - row["attributed_expense_cents"] - assigned[index]

    net = totals["revenue"] - sum(value for key, value in totals.items() if key != "revenue")
    sales_total = sum(order["total_cents"] for order in new_orders)
    previous_month = _previous_month(year, number)
    return {
        "month": month, "revenue_cents": totals["revenue"], "cogs_cents": totals["cogs"],
        "commission_cents": totals["commission"], "shipping_cents": totals["shipping"],
        "packaging_cents": totals["packaging"], "operating_cents": totals["operating_expense"],
        "loss_cents": totals["inventory_loss"], "gross_profit_cents": None if missing else totals["revenue"] - totals["cogs"],
        "net_profit_cents": None if missing else net, "known_result_cents": net,
        "incomplete_cost_count": len(missing), "incomplete_order_ids": sorted(missing),
        "sales_count": len(new_orders),
        "average_ticket_cents": round_ratio(sales_total, len(new_orders)) if new_orders else 0,
        "new_sales_cents": sales_total,
        "discount_cents": sum(order.get("discount_cents", 0) for order in new_orders),
        "channels": sorted(rows.values(), key=lambda row: (row["profit_cents"] is None, -(row["profit_cents"] or 0), row["channel"])),
        "shared_expense_cents": unassigned,
        "unallocated_expense_cents": unassigned - sum(assigned),
        "allocation_mode": "net_revenue_proportion" if allocate_shared else "none",
        "daily": [{"date": day, "total_cents": value} for day, value in daily.items()],
        "previous_revenue_cents": sum(event["amount_cents"] for event in all_events if event["bucket"] == "revenue" and event["business_date"].startswith(previous_month + "-")),
        **_order_balances(data),
    }


def daily_report(db, business_date: str, opening_cents: int = 0) -> dict:
    day = _date(business_date)
    integer(opening_cents, "Fondo inicial")
    data = db.snapshot()
    entries = [entry for entry in data.get("cash_entries", []) if entry["business_date"] == day]
    rows = []
    for method in PAYMENT_METHODS:
        selected = [entry["delta_cents"] for entry in entries if entry["method"] == method]
        income = sum(value for value in selected if value > 0)
        expense = -sum(value for value in selected if value < 0)
        rows.append({"method": method, "income_cents": income, "expense_cents": expense, "balance_cents": income - expense})
    closes = [closing for closing in data.get("cash_closings", []) if closing["business_date"] == day]
    latest = max(closes, key=lambda closing: (closing["cutoff_sequence"], closing["created_at"], closing["id"])) if closes else None
    return {
        "business_date": day, "by_method": rows,
        "expected_cash_cents": opening_cents + next(row["balance_cents"] for row in rows if row["method"] == "Efectivo"),
        "credit_sales_cents": sum(order["total_cents"] for order in data.get("orders", []) if order.get("completed_date") == day and order["terms"] == "credit"),
        "receipts_cents": sum(row["income_cents"] for row in rows),
        "expenses_cents": sum(row["expense_cents"] for row in rows),
        "closing": latest, "closing_count": len(closes),
        "late_movements_count": sum(1 for entry in entries if latest and entry["sequence"] > latest["cutoff_sequence"]),
    }


def close_cash(db, business_date: str, opening_cents: int, counted_cents: int, note: str = "", *, allow_revision: bool = False) -> dict:
    """Append a cash closing; explicit revision retains all earlier snapshots."""
    day = _date(business_date)
    integer(opening_cents, "Fondo inicial")
    integer(counted_cents, "Efectivo contado")
    if not isinstance(note, str) or len(note) > 2000:
        raise ValueError("La nota del cierre puede tener hasta 2.000 caracteres.")
    with db.transaction():
        existing = db.connection.execute("SELECT COUNT(*) FROM cash_closings WHERE business_date=?", (day,)).fetchone()[0]
        if existing and not allow_revision:
            raise ValueError("Ya hay un cierre guardado para esta fecha. Usá la rectificación explícita para conservar ambos registros.")
        balance = db.connection.execute("SELECT COALESCE(SUM(delta_cents),0) FROM cash_entries WHERE business_date=? AND method='Efectivo'", (day,)).fetchone()[0]
        expected = opening_cents + balance
        integer(expected, "Efectivo esperado", -MAX_CENTS, MAX_CENTS)
        cutoff = db.connection.execute("SELECT COALESCE(MAX(sequence),0) FROM cash_entries").fetchone()[0]
        closing_id = str(uuid4())
        created_at = datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
        db.connection.execute("INSERT INTO cash_closings(id,business_date,opening_cents,expected_cents,counted_cents,difference_cents,cutoff_sequence,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                              (closing_id, day, opening_cents, expected, counted_cents, counted_cents - expected, cutoff, note.strip(), created_at))
        result = dict(db.connection.execute("SELECT * FROM cash_closings WHERE id=?", (closing_id,)).fetchone())
        result["revision_number"] = existing + 1
        return result
