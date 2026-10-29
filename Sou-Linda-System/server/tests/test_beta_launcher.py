"""The beta must be useful on first launch without adopting the real business."""
import json
import os
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

from sadi_local.db import Database, TABLES
from sadi_local.services import SadiService


@pytest.fixture
def launcher(monkeypatch, tmp_path):
    path = Path(__file__).resolve().parents[1] / 'run.py'
    spec = spec_from_file_location('sou_linda_beta_launcher_tests', path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv('SADI_DATA_DIR', str(tmp_path / 'SouLindaSystem'))
    return module


def fake_server(launcher, monkeypatch):
    import sadi_local.web
    import uvicorn
    created, served, opened = [], [], []
    app = object()

    def create(path, **options):
        created.append((path, options))
        return app

    class ImmediateTimer:
        def __init__(self, interval, callback):
            self.callback = callback
        def start(self):
            self.callback()
        def cancel(self):
            pass

    monkeypatch.setattr(sadi_local.web, 'create_app', create)
    monkeypatch.setattr(uvicorn, 'run', lambda application, **options: served.append((application, options)))
    monkeypatch.setattr(launcher, 'Timer', ImmediateTimer)
    monkeypatch.setattr(launcher.webbrowser, 'open', opened.append)
    return created, served, opened


def test_beta_production_folder_rejected_before_lock_or_database_access(launcher, monkeypatch, tmp_path, capsys):
    production = tmp_path / 'SouLindaSystem'
    production.mkdir()
    database = production / 'sou-linda.sqlite3'
    database.write_bytes(b'real business must remain byte-for-byte unchanged')

    def forbidden(*args, **kwargs):
        pytest.fail('The rejected production folder must not acquire a lock or open SQLite')
    monkeypatch.setattr(launcher, 'InstanceLock', forbidden)
    monkeypatch.setattr(launcher, 'Database', forbidden)

    assert launcher.main(['--beta', '--no-browser', '--data-dir', str(production / '..' / production.name)]) == 1
    assert 'negocio real' in capsys.readouterr().err
    assert database.read_bytes() == b'real business must remain byte-for-byte unchanged'
    assert list(production.iterdir()) == [database]


def test_beta_refuses_unknown_existing_database_without_backing_it_up(launcher, monkeypatch, tmp_path):
    folder = tmp_path / 'unknown'
    folder.mkdir()
    database = folder / 'sou-linda.sqlite3'
    database.write_bytes(b'foreign database')

    def forbidden(*args, **kwargs):
        pytest.fail('An unidentified database must never be opened, including during shutdown')
    monkeypatch.setattr(launcher, 'Database', forbidden)
    assert launcher.main(['--beta', '--no-browser', '--data-dir', str(folder)]) == 1
    assert database.read_bytes() == b'foreign database'
    assert not (folder / launcher.BETA_MARKER_NAME).exists()
    assert not (folder / 'backups').exists()


@pytest.mark.parametrize('link_kind', ['directory', 'database', 'hardlink', 'wal_hardlink'])
def test_beta_rejects_linked_real_business_before_lock(launcher, monkeypatch, tmp_path, link_kind):
    production = tmp_path / 'SouLindaSystem'
    production.mkdir()
    database = production / 'sou-linda.sqlite3'
    database.write_bytes(b'real business database must never be opened')
    wal = production / 'sou-linda.sqlite3-wal'
    wal.write_bytes(b'real business uncheckpointed transactions')
    trial = tmp_path / 'trial'
    if link_kind == 'directory':
        trial.symlink_to(production, target_is_directory=True)
    else:
        trial.mkdir()
        if link_kind == 'database':
            (trial / database.name).symlink_to(database)
        elif link_kind == 'hardlink':
            os.link(database, trial / database.name)
        else:
            os.link(wal, trial / wal.name)

    def forbidden(*args, **kwargs):
        pytest.fail('A linked real business must not acquire a lock or open SQLite')
    monkeypatch.setattr(launcher, 'InstanceLock', forbidden)
    monkeypatch.setattr(launcher, 'Database', forbidden)
    assert launcher.main(['--beta', '--no-browser', '--data-dir', str(trial)]) == 1
    assert database.read_bytes() == b'real business database must never be opened'
    assert wal.read_bytes() == b'real business uncheckpointed transactions'
    assert sorted(item.name for item in production.iterdir()) == ['sou-linda.sqlite3', 'sou-linda.sqlite3-wal']


def test_windows_beta_default_stays_in_distinct_local_appdata_directory(launcher, monkeypatch, tmp_path):
    import sadi_local.paths
    monkeypatch.delenv('SADI_DATA_DIR')
    monkeypatch.setattr(sadi_local.paths.sys, 'platform', 'win32')
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path / 'Windows Profile' / 'Local'))
    production = tmp_path / 'Windows Profile' / 'Local' / 'SouLindaSystem'
    assert launcher.data_directory() == production
    assert launcher.beta_data_directory() == production.with_name('SouLindaSystemBeta')
    assert not production.parent.exists()


def test_beta_seeds_pyg_once_and_preserves_subsequent_edits(launcher, tmp_path):
    folder = tmp_path / 'trial'
    path = launcher.prepare_beta_database(folder)
    db = Database(path)
    try:
        assert db.get_meta('currency') == 'PYG'
        assert db.get_meta('demo') == 'true'
        assert db.connection.execute('SELECT COUNT(*) FROM orders').fetchone()[0] == 22
        service = SadiService(db)
        service.save_customer('Clienta de la prueba', '+595900000099')
        variant = next(row for row in service.list_variants() if row['available'] > 0)
        service.create_order([dict(variant_id=variant['id'], quantity=1, unit_price_cents=variant['retail_cents'])], 'Local')
        edited = db.snapshot()
    finally:
        db.close()

    assert launcher.prepare_beta_database(folder) == path
    db = Database(path)
    try:
        assert db.snapshot() == edited
    finally:
        db.close()
    marker = json.loads((folder / launcher.BETA_MARKER_NAME).read_text())
    assert marker == {'application': launcher.BETA_APPLICATION, 'version': 1, 'seeded': True}


def test_beta_does_not_reseed_after_intentional_demo_clear(launcher, tmp_path):
    folder = tmp_path / 'trial'
    path = launcher.prepare_beta_database(folder)
    db = Database(path)
    try:
        with db.transaction():
            for table in reversed(TABLES):
                db.connection.execute(f'DELETE FROM "{table}"')
    finally:
        db.close()
    launcher.prepare_beta_database(folder)
    db = Database(path)
    try:
        assert db.get_meta('currency') == 'PYG'
        assert db.get_meta('demo') is None
        assert db.connection.execute('SELECT COUNT(*) FROM orders').fetchone()[0] == 0
        assert db.connection.execute('SELECT COUNT(*) FROM customers').fetchone()[0] == 0
    finally:
        db.close()


def test_failed_seed_rolls_back_and_can_retry_without_partial_demo(launcher, monkeypatch, tmp_path):
    import sadi_local.demo
    original = sadi_local.demo.seed_demo
    folder = tmp_path / 'trial'

    def interrupted(service):
        service.save_customer('Partial customer must roll back')
        raise RuntimeError('interrupted seed')
    monkeypatch.setattr(sadi_local.demo, 'seed_demo', interrupted)
    with pytest.raises(RuntimeError, match='interrupted seed'):
        launcher.prepare_beta_database(folder)
    marker = json.loads((folder / launcher.BETA_MARKER_NAME).read_text())
    assert marker['seeded'] is False
    db = Database(folder / 'sou-linda.sqlite3')
    try:
        assert db.get_meta('currency') is None
        assert db.connection.execute('SELECT COUNT(*) FROM customers').fetchone()[0] == 0
    finally:
        db.close()
    monkeypatch.setattr(sadi_local.demo, 'seed_demo', original)
    launcher.prepare_beta_database(folder)
    db = Database(folder / 'sou-linda.sqlite3')
    try:
        assert db.connection.execute('SELECT COUNT(*) FROM customers').fetchone()[0] == 4
        assert db.connection.execute('SELECT COUNT(*) FROM orders').fetchone()[0] == 22
    finally:
        db.close()


def test_committed_seed_recovers_if_final_marker_write_is_interrupted(launcher, monkeypatch, tmp_path):
    import sadi_local.demo
    folder = tmp_path / 'trial'
    original_writer = launcher._write_beta_marker

    def fail_final_marker(target, seeded):
        if seeded:
            raise OSError('interrupted marker')
        original_writer(target, seeded)
    monkeypatch.setattr(launcher, '_write_beta_marker', fail_final_marker)
    with pytest.raises(OSError, match='interrupted marker'):
        launcher.prepare_beta_database(folder)
    assert json.loads((folder / launcher.BETA_MARKER_NAME).read_text())['seeded'] is False
    db = Database(folder / 'sou-linda.sqlite3')
    try:
        before = db.snapshot()
        assert db.get_meta('beta_seeded') == 'true'
    finally:
        db.close()

    def do_not_seed_twice(*args, **kwargs):
        pytest.fail('The committed demonstration must not be duplicated after a marker interruption')
    monkeypatch.setattr(launcher, '_write_beta_marker', original_writer)
    monkeypatch.setattr(sadi_local.demo, 'seed_demo', do_not_seed_twice)
    launcher.prepare_beta_database(folder)
    db = Database(folder / 'sou-linda.sqlite3')
    try:
        assert db.snapshot() == before
    finally:
        db.close()
    assert json.loads((folder / launcher.BETA_MARKER_NAME).read_text())['seeded'] is True


@pytest.mark.parametrize('beta,port,path_suffix,folder_name', [
    (False, 8765, '', 'SouLindaSystem'),
    (True, 8766, '/agil', 'SouLindaSystemBeta'),
])
def test_beta_and_standard_defaults_use_separate_folders_ports_and_views(launcher, monkeypatch, tmp_path, beta, port, path_suffix, folder_name):
    created, served, opened = fake_server(launcher, monkeypatch)
    assert launcher.main(['--beta'] if beta else []) == 0
    assert opened == [f'http://127.0.0.1:{port}{path_suffix}']
    assert created[0][0] == tmp_path / folder_name / 'sou-linda.sqlite3'
    assert created[0][1]['beta_mode'] is beta
    assert served[0][1]['port'] == port
    if beta:
        assert not (tmp_path / 'SouLindaSystem').exists()


def test_beta_explicit_port_view_and_test_folder_override_defaults(launcher, monkeypatch, tmp_path):
    created, served, opened = fake_server(launcher, monkeypatch)
    folder = tmp_path / 'custom-test'
    assert launcher.main(['--beta', '--port', '8772', '--view', 'classic', '--data-dir', str(folder)]) == 0
    assert opened == ['http://127.0.0.1:8772']
    assert created[0][0] == folder / 'sou-linda.sqlite3'
    assert created[0][1]['beta_mode'] is True
    assert served[0][1]['port'] == 8772


@pytest.mark.parametrize('marker', [
    {'application': 'Another application', 'version': 1, 'seeded': True},
    {'application': 'Sou Linda System Beta', 'version': 2, 'seeded': True},
    {'application': 'Sou Linda System Beta', 'version': 1, 'seeded': 'true'},
])
def test_unknown_beta_marker_is_rejected_before_database_creation(launcher, tmp_path, marker):
    folder = tmp_path / 'trial'
    folder.mkdir()
    (folder / launcher.BETA_MARKER_NAME).write_text(json.dumps(marker))
    with pytest.raises(ValueError, match='identificada'):
        launcher.prepare_beta_database(folder)
    assert not (folder / 'sou-linda.sqlite3').exists()
