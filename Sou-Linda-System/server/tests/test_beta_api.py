"""Beta edition labels and sessions belong to the running server, not a backup."""
from fastapi.testclient import TestClient
import pytest

from sadi_local.db import Database
from sadi_local.web import create_app


def client_for(app, port=8766):
    return TestClient(app, base_url=f'http://localhost:{port}', client=('127.0.0.1', 50123))


def session(client):
    response = client.get('/api/session')
    assert response.status_code == 200
    return {'X-SADI-CSRF': response.json()['csrfToken']}


def runtime_mode(client):
    response = client.get('/api/snapshot')
    assert response.status_code == 200, response.text
    settings = response.json()['settings']
    modes = [setting['value'] for setting in settings if setting['key'] == 'runtime_mode']
    assert len(modes) == 1
    return modes[0]


@pytest.mark.parametrize('beta_mode,expected', [(False, 'standard'), (True, 'beta')])
def test_snapshot_mode_is_runtime_only_and_not_written_to_backup(tmp_path, beta_mode, expected):
    path = tmp_path / 'business.sqlite3'
    with client_for(create_app(path, beta_mode=beta_mode)) as client:
        session(client)
        assert runtime_mode(client) == expected
        response = client.get('/api/backup')
        assert response.status_code == 200
        tables = response.json()['payload']['tables']
        assert not any(setting['key'] == 'runtime_mode' for setting in tables['meta'])
    db = Database(path)
    try:
        assert db.get_meta('runtime_mode') is None
    finally:
        db.close()


@pytest.mark.parametrize('beta_mode,expected,spoofed', [(False, 'standard', 'beta'), (True, 'beta', 'standard')])
def test_restored_settings_cannot_change_runtime_edition(tmp_path, beta_mode, expected, spoofed):
    path = tmp_path / 'business.sqlite3'
    # Prepare a valid backup that happens to contain a conflicting setting.
    # Its data may be restored, but that metadata does not control this process.
    db = Database(path)
    db.set_meta('runtime_mode', spoofed)
    db.close()
    with client_for(create_app(path, beta_mode=beta_mode)) as client:
        headers = session(client)
        assert runtime_mode(client) == expected
        backup = client.get('/api/backup').text
        response = client.post('/api/backup/restore', headers=headers,
                               json={'content': backup, 'confirmed': True})
        assert response.status_code == 200, response.text
        assert runtime_mode(client) == expected


def test_clearing_demo_does_not_remove_beta_runtime_label(tmp_path):
    with client_for(create_app(tmp_path / 'beta.sqlite3', beta_mode=True)) as client:
        headers = session(client)
        assert client.post('/api/demo', headers=headers, json={}).status_code == 200
        assert runtime_mode(client) == 'beta'
        response = client.post('/api/demo/clear', headers=headers, json={'confirmation': 'ELIMINAR'})
        assert response.status_code == 200, response.text
        assert runtime_mode(client) == 'beta'
        snapshot = client.get('/api/snapshot').json()
        assert snapshot['products'] == []
        assert {'key': 'currency', 'value': 'PYG'} in snapshot['settings']


def test_beta_and_normal_sessions_coexist_in_the_same_browser_cookie_jar(tmp_path):
    regular = create_app(tmp_path / 'normal' / 'business.sqlite3')
    beta = create_app(tmp_path / 'beta' / 'business.sqlite3', beta_mode=True)
    with client_for(regular, 8765) as normal_client, client_for(beta, 8766) as beta_client:
        normal_headers = session(normal_client)
        beta_headers = session(beta_client)
        assert normal_client.cookies.get('sadi_session')
        assert beta_client.cookies.get('sadi_beta_session')
        assert normal_client.cookies.get('sadi_beta_session') is None
        assert beta_client.cookies.get('sadi_session') is None
        # A browser attaches both host cookies to either port. Neither process
        # should overwrite or accidentally accept the other edition's secret.
        normal_client.cookies.update(beta_client.cookies)
        beta_client.cookies.update(normal_client.cookies)
        assert runtime_mode(normal_client) == 'standard'
        assert runtime_mode(beta_client) == 'beta'
        assert normal_client.post('/api/drafts/pos', headers=normal_headers, json={'draft': {'note': 'normal'}}).status_code == 200
        assert beta_client.post('/api/drafts/pos', headers=beta_headers, json={'draft': {'note': 'beta'}}).status_code == 200
        assert normal_client.get('/api/drafts/pos').json()['draft'] == {'note': 'normal'}
        assert beta_client.get('/api/drafts/pos').json()['draft'] == {'note': 'beta'}
        # A token from the other edition never grants write access.
        assert normal_client.post('/api/drafts/pos', headers=beta_headers, json={'draft': None}).status_code == 403
        assert beta_client.post('/api/drafts/pos', headers=normal_headers, json={'draft': None}).status_code == 403


def test_beta_still_requires_local_authenticated_admin(tmp_path):
    with client_for(create_app(tmp_path / 'beta.sqlite3', beta_mode=True)) as client:
        assert client.get('/api/snapshot').status_code == 401
        session(client)
        original = client._transport.client
        client._transport.client = ('192.168.1.44', 50123)
        try:
            assert client.get('/api/snapshot').status_code == 403
            assert client.get('/api/session').status_code == 403
        finally:
            client._transport.client = original
