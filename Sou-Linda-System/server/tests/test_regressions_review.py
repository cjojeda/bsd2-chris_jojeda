"""Cross-module regression checks from the independent financial review."""
from pathlib import Path
import sqlite3

import pytest

from sadi_local.db import Database
from sadi_local.services import SadiService
from sadi_local import transfer
from sadi_local.reports import monthly_report


@pytest.fixture
def business():
    db = Database(":memory:")
    service = SadiService(db)
    vid = service.save_variant({"model": "Valentina", "category": "Conjuntos", "sku": "VAL-95-R",
        "size": "95", "color": "Rojo", "retail_cents": 200000, "wholesale_cents": 170000,
        "min_stock": 1, "initial_qty": 10, "initial_unit_cost_cents": 120000})
    yield db, service, vid
    db.close()


def _rehash(document):
    document["sha256"] = transfer._hash({key: value for key, value in document.items() if key != "sha256"})
    return document


def _completed(service, vid):
    return service.create_order([{"variant_id": vid, "quantity": 1, "unit_price_cents": 200000}],
        channel="Instagram", business_date="2026-10-01", commission_bps=300)


def test_restore_rejects_cash_that_disagrees_with_the_recorded_receipt(business):
    db, service, vid = business
    _completed(service, vid)
    document = transfer.make_backup(db)
    receipt = next(row for row in document["payload"]["tables"]["cash_entries"] if row["kind"] == "receipt")
    receipt["delta_cents"] += 1
    with pytest.raises(ValueError):
        transfer.validate_backup(_rehash(document))


def test_restore_rejects_fee_ledger_that_disagrees_with_the_recorded_payment(business):
    db, service, vid = business
    _completed(service, vid)
    document = transfer.make_backup(db)
    fee = next(row for row in document["payload"]["tables"]["economic_entries"] if row["bucket"] == "commission")
    fee["amount_cents"] += 1
    with pytest.raises(ValueError):
        transfer.validate_backup(_rehash(document))


def test_restore_rejects_expense_ledger_that_disagrees_with_its_document(business):
    db, service, _ = business
    service.save_expense("2026-10-01", "Publicidad", "Campaña", 15000, "Transferencia")
    document = transfer.make_backup(db)
    expense = next(row for row in document["payload"]["tables"]["economic_entries"] if row["bucket"] == "operating_expense")
    expense["amount_cents"] += 1
    with pytest.raises(ValueError):
        transfer.validate_backup(_rehash(document))


def test_return_in_november_does_not_erase_octobers_result(business):
    db, service, vid = business
    order = _completed(service, vid)
    service.return_order(order, business_date="2026-11-02")
    october = monthly_report(db, "2026-10")
    november = monthly_report(db, "2026-11")
    assert october["revenue_cents"] == 200000
    assert october["cogs_cents"] == 120000
    assert october["commission_cents"] == 6000
    assert october["net_profit_cents"] == 74000
    assert november["revenue_cents"] == -200000
    assert november["cogs_cents"] == -120000
    assert november["net_profit_cents"] == -80000


def test_cpp_changes_for_reserved_units_only_when_the_sale_completes(business):
    db, service, vid = business
    order = service.create_order([{"variant_id": vid, "quantity": 2, "unit_price_cents": 200000}],
        channel="WhatsApp", business_date="2026-10-01", status="reserved")
    service.receive_stock(vid, 10, 1600000, business_date="2026-10-02")
    assert service.list_variants()[0]["value_cents"] == 2800000
    service.complete_order(order, business_date="2026-10-03")
    assert service.get_order(order)["cogs_cents"] == 280000
    assert service.list_variants()[0]["reserved"] == 0
    assert service.list_variants()[0]["on_hand"] == 18


def test_sqlite_backup_closes_the_destination_before_atomic_replace(tmp_path, monkeypatch):
    db = Database(tmp_path / "live.sqlite3")
    real_connect = sqlite3.connect
    real_replace = transfer.os.replace
    connections = []
    class TrackedConnection(sqlite3.Connection):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.closed = False
        def close(self):
            self.closed = True
            return super().close()
    def connect(*args, **kwargs):
        kwargs["factory"] = TrackedConnection
        result = real_connect(*args, **kwargs)
        connections.append(result)
        return result
    def replace(source, target):
        assert connections and all(connection.closed for connection in connections), "Windows cannot replace an open SQLite file"
        return real_replace(source, target)
    monkeypatch.setattr(transfer.sqlite3, "connect", connect)
    monkeypatch.setattr(transfer.os, "replace", replace)
    try:
        transfer.export_sqlite(db, tmp_path / "backup.sqlite3")
    finally:
        for connection in connections:
            if not connection.closed:
                connection.close()
        db.close()


@pytest.mark.parametrize("suffix", ["-wal", "-shm"])
def test_backup_never_overwrites_the_live_databases_sidecars(tmp_path, suffix):
    db = Database(tmp_path / "live.sqlite3")
    try:
        with pytest.raises(ValueError):
            transfer._protect_database_path(db, Path(str(db.path) + suffix))
    finally:
        db.close()
