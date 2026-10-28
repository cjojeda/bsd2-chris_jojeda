"""Launch behavior that protects the notebook's persistent business data."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import socket

import pytest


@pytest.fixture
def launcher():
    path = Path(__file__).resolve().parents[1] / 'run.py'
    spec = spec_from_file_location('sou_linda_launcher_tests', path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_self_test_leaves_real_business_untouched_and_cleans_temporary_database(launcher, monkeypatch, tmp_path):
    business = tmp_path / 'business'
    business.mkdir()
    database = business / 'sou-linda.sqlite3'
    database.write_bytes(b'existing business must never be opened by self-test')
    temporary_root = tmp_path / 'temporary'
    temporary_root.mkdir()
    monkeypatch.setenv('SADI_DATA_DIR', str(business))
    monkeypatch.setattr(launcher.tempfile, 'tempdir', str(temporary_root))

    assert launcher.main(['--self-test', '--data-dir', str(business)]) == 0

    assert database.read_bytes() == b'existing business must never be opened by self-test'
    assert list(business.iterdir()) == [database]
    assert list(temporary_root.iterdir()) == []


def test_instance_lock_excludes_second_launcher_then_releases(launcher, tmp_path):
    first = launcher.InstanceLock(tmp_path)
    try:
        with pytest.raises(RuntimeError, match='ya está abierto'):
            launcher.InstanceLock(tmp_path)
    finally:
        first.close()
        first.close()
    second = launcher.InstanceLock(tmp_path)
    second.close()


def test_failed_lock_acquisition_never_opens_or_backs_up_active_business(launcher, monkeypatch, tmp_path, capsys):
    distribution = Path(launcher.__file__).resolve().parents[1]
    if not (distribution / 'dist' / 'index.html').exists():
        pytest.skip('Requires the frontend distribution from npm run build')
    active = launcher.InstanceLock(tmp_path)
    def forbidden_database(*args, **kwargs):
        pytest.fail('A rejected second launcher must not touch the active database')
    monkeypatch.setattr(launcher, 'Database', forbidden_database)
    try:
        assert launcher.main(['--no-browser', '--data-dir', str(tmp_path)]) == 1
        assert 'ya está abierto' in capsys.readouterr().err
    finally:
        active.close()
    assert not (tmp_path / 'backups').exists()


def test_lan_detection_uses_only_local_private_ipv4_without_external_probe(launcher, monkeypatch):
    calls = []
    def records(host, port, *, family):
        calls.append((host, port, family))
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, 0)) for address in (
            '192.168.1.7', '10.0.0.5', '192.168.1.7', '127.0.0.1',
            '169.254.1.5', '0.0.0.0', '8.8.8.8')]
    monkeypatch.setattr(launcher.socket, 'gethostname', lambda: 'notebook')
    monkeypatch.setattr(launcher.socket, 'getaddrinfo', records)

    assert launcher.lan_addresses() == ['10.0.0.5', '192.168.1.7']
    assert calls == [('notebook', None, socket.AF_INET)]


def test_missing_network_interfaces_does_not_break_local_launch(launcher, monkeypatch):
    def unavailable(*args, **kwargs):
        raise OSError('network disconnected')
    monkeypatch.setattr(launcher.socket, 'getaddrinfo', unavailable)
    assert launcher.lan_addresses() == []


@pytest.mark.parametrize('view_arguments,expected_path', [
    ([], ''),
    (['--view', 'classic'], ''),
    (['--view', 'agile'], '/agil'),
])
def test_browser_opens_selected_view_with_the_same_database(launcher, monkeypatch, tmp_path, view_arguments, expected_path):
    distribution = Path(launcher.__file__).resolve().parents[1]
    if not (distribution / 'dist' / 'index.html').exists():
        pytest.skip('Requires the frontend distribution from npm run build')
    import sadi_local.web
    import uvicorn
    opened = []
    created = []
    served = []
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

    assert launcher.main(['--port', '8767', '--data-dir', str(tmp_path), *view_arguments]) == 0

    assert opened == [f'http://127.0.0.1:8767{expected_path}']
    assert created[0][0] == tmp_path / 'sou-linda.sqlite3'
    assert created[0][1]['allow_mobile'] is False
    assert served == [(app, {'host': '127.0.0.1', 'port': 8767, 'workers': 1,
                             'proxy_headers': False, 'access_log': False, 'log_level': 'info'})]
    assert (tmp_path / 'sou-linda.sqlite3').is_file()


def test_unknown_view_is_rejected_before_opening_the_business(launcher, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail('An invalid view must not open the business database')
    monkeypatch.setattr(launcher, 'Database', forbidden)
    with pytest.raises(SystemExit) as error:
        launcher.main(['--view', 'unknown'])
    assert error.value.code == 2
