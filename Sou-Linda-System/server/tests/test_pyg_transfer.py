"""Guarani import/export and backup precision, independent of UI formatting."""
from copy import deepcopy
import csv
import io
import json

from fastapi.testclient import TestClient
from openpyxl import load_workbook
import pytest

from sadi_local.currency import currency_code, initialize_business_currency
from sadi_local.db import Database
from sadi_local.reports import monthly_report
from sadi_local.services import SadiService
from sadi_local.transfer import (
    _hash, _import_money, apply_import, export_json, export_table,
    make_backup, preview_import, restore_json, validate_backup,
)
from sadi_local.web import create_app


@pytest.fixture
def service(tmp_path):
    db = Database(tmp_path / 'guaranies.sqlite3')
    initialize_business_currency(db)
    assert currency_code(db) == 'PYG'
    yield SadiService(db)
    db.close()


def variant(service, sku='VAL-PY', **changes):
    payload = dict(model='Valentina', category='Conjuntos', sku=sku, size='95', color='Rojo',
                   retail_cents=5_000_000, wholesale_cents=4_000_000, min_stock=1,
                   initial_qty=3, initial_unit_cost_cents=3_000_000)
    payload.update(changes)
    return service.save_variant(payload)


def csv_file(tmp_path, name, rows):
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=list(rows[0]), delimiter=';')
    writer.writeheader()
    writer.writerows(rows)
    path = tmp_path / name
    path.write_text(stream.getvalue(), encoding='utf-8-sig')
    return path


@pytest.mark.parametrize('text, expected', [
    ('50000', 5_000_000), ('50.000', 5_000_000), ('1.250.000', 125_000_000),
    ('50.000,00', 5_000_000), ('50000.00', 5_000_000), ('50000,0', 5_000_000),
    ('Gs. 50.000', 5_000_000), ('₲ 50.000', 5_000_000), ('0', 0),
])
def test_pyg_import_preserves_whole_units_and_paraguayan_thousands(service, text, expected):
    assert _import_money(service.db, text) == expected


@pytest.mark.parametrize('text', ['0.50', '50000,5', '1.250,50', '50,000', '5e4', '-50000', '5.00.000'])
def test_pyg_import_rejects_fractional_or_ambiguous_values(service, text):
    with pytest.raises(ValueError):
        _import_money(service.db, text)


def test_guarani_catalog_csv_export_and_excel_keep_full_monetary_value(service, tmp_path):
    path = csv_file(tmp_path, 'productos.csv', [dict(modelo='Valentina', categoria='Conjuntos', sku='VAL-PY',
        talle='95', color='Rojo', costo='30.000', pvp='50.000', mayorista='40000', stock='3', stock_minimo='1')])
    plan = preview_import(service, path, 'variants')
    assert plan.ready, plan.errors
    apply_import(service, plan)
    row = service.list_variants()[0]
    assert (row['retail_cents'], row['value_cents']) == (5_000_000, 9_000_000)
    output = export_table(service, tmp_path / 'variantes.csv', 'variants')
    exported = list(csv.DictReader(io.StringIO(output.read_text(encoding='utf-8-sig')), delimiter=';'))
    assert exported[0]['pvp'] == '50000'
    xlsx = export_table(service, tmp_path / 'variantes.xlsx', 'variants')
    book = load_workbook(xlsx)
    try:
        assert book.active['G2'].value == 50000
        assert book.active['G2'].number_format == '"₲" #,##0'
        assert 'PYG' in book.properties.description
    finally:
        book.close()


def test_historical_import_rounds_actual_commission_and_retains_backup_currency(service, tmp_path):
    variant(service)
    path = csv_file(tmp_path, 'historico.csv', [dict(id_externo='PY-1', fecha='2026-10-10', sku='VAL-PY',
        cantidad='1', precio_unitario='50.000', costo_unitario='30.000', canal='Instagram',
        medio_pago='Transferencia', envio='1.000', packaging='500', descuento='6.250',
        comision_porcentaje='3', cliente='', cliente_id='', fecha_cobro='2026-10-10')])
    plan = preview_import(service, path, 'sales')
    assert plan.ready, plan.errors
    order_id = apply_import(service, plan, acknowledge_warnings=True)['ids'][0]
    sale = service.get_order(order_id)
    assert sale['total_cents'] == 4_375_000
    assert sale['commission_cents'] == 131_300  # ₲1,312.5 becomes ₲1,313.
    assert sale['net_profit_cents'] == 1_093_700
    assert service.list_variants()[0]['on_hand'] == 3
    backup = make_backup(service.db)
    assert validate_backup(backup)['meta'] == backup['payload']['tables']['meta']
    report = monthly_report(service.db, '2026-10')
    backup_path = export_json(service.db, tmp_path / 'respaldo.json')
    other = Database(tmp_path / 'restaurado.sqlite3')
    try:
        restore_json(other, backup_path)
        assert currency_code(other) == 'PYG'
        assert monthly_report(other, '2026-10') == report
    finally:
        other.close()


def test_backup_rejects_fractional_guarani_records_even_with_valid_checksum(service):
    variant(service)
    backup = deepcopy(make_backup(service.db))
    backup['payload']['tables']['variants'][0]['retail_cents'] += 1
    backup['sha256'] = _hash({key: value for key, value in backup.items() if key != 'sha256'})
    with pytest.raises(ValueError, match='fracciones de guaraní'):
        validate_backup(backup)


def test_web_restore_of_legacy_ars_retains_original_values_and_currency(tmp_path):
    legacy = Database(tmp_path / 'anterior.sqlite3')
    try:
        old_service = SadiService(legacy)
        variant(old_service, retail_cents=125050, initial_unit_cost_cents=10025)
        # This is a real pre-metadata backup; do not relabel it as PYG.
        document = make_backup(legacy)
        assert all(row['key'] != 'currency' for row in document['payload']['tables']['meta'])
    finally:
        legacy.close()
    app = create_app(tmp_path / 'web.sqlite3')
    with TestClient(app, base_url='http://localhost:8765', client=('127.0.0.1', 50001)) as client:
        headers = {'X-SADI-CSRF': client.get('/api/session').json()['csrfToken']}
        check = client.post('/api/backup/validate', headers=headers, json={'content': json.dumps(document)})
        assert check.json()['currency'] == 'ARS'
        result = client.post('/api/backup/restore', headers=headers, json={'content': json.dumps(document), 'confirmed': True})
        assert result.status_code == 200, result.text
        assert result.json()['currency'] == 'ARS'
        snapshot = client.get('/api/snapshot').json()
        assert snapshot['variants'][0]['retailPrice'] == 125050
        assert {'key': 'currency', 'value': 'ARS'} in snapshot['settings']


def test_web_clearing_legacy_demo_initializes_empty_paraguayan_business(tmp_path):
    db = Database(tmp_path / 'demo.sqlite3')
    db.set_meta('currency', 'ARS')
    db.set_meta('demo', 'true')
    db.close()
    app = create_app(tmp_path / 'demo.sqlite3')
    with TestClient(app, base_url='http://localhost:8765', client=('127.0.0.1', 50001)) as client:
        headers = {'X-SADI-CSRF': client.get('/api/session').json()['csrfToken']}
        result = client.post('/api/demo/clear', headers=headers, json={'confirmation': 'ELIMINAR'})
        assert result.status_code == 200, result.text
        assert result.json()['currency'] == 'PYG'
        assert client.get('/api/snapshot').json()['settings'] == [
            {'key': 'currency', 'value': 'PYG'},
            {'key': 'runtime_mode', 'value': 'standard'},
        ]
