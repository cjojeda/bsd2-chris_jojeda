"""Real HTTP requests across the SQLite, local-admin and read-only LAN boundary."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sadi_local.web import create_app


@pytest.fixture
def api(tmp_path):
    app = create_app(tmp_path / 'business.sqlite3', allow_mobile=True,
                     report_addresses=['http://192.168.1.20:8765'])
    with TestClient(app, base_url='http://localhost:8765', client=('127.0.0.1', 51111)) as client:
        session = client.get('/api/session')
        assert session.status_code == 200
        headers = {'X-SADI-CSRF': session.json()['csrfToken']}
        yield client, headers, tmp_path


@contextmanager
def peer(client, host):
    """Set the actual ASGI peer, never a forwarded-header workaround."""
    original = client._transport.client
    client._transport.client = (host, 51222)
    try:
        yield
    finally:
        client._transport.client = original


def variant(client, headers, *, stock=10, cost=120000, sku='VAL-95-R'):
    response = client.post('/api/variants', headers=headers, json={
        'name': 'Valentina', 'category': 'Conjuntos', 'sku': sku, 'size': '95', 'color': 'Rojo',
        'cost': cost, 'retailPrice': 200000, 'wholesalePrice': 170000,
        'stock': stock, 'minStock': 2,
    })
    assert response.status_code == 200, response.text
    return response.json()['id']


def sale(client, headers, variant_id, **changes):
    payload = {'date': '2026-10-01', 'channel': 'Instagram', 'paymentMethod': 'Transferencia',
        'items': [{'variantId': variant_id, 'quantity': 2, 'unitPrice': 200000}],
        'shippingCost': 20000, 'packagingCost': 5000, 'discount': 0,
        'discountKind': 'percent', 'discountValue': 1000, 'commissionRate': 300,
        'directCostMethod': 'Efectivo', 'directCostsPaid': True, 'commandId': 'sale-test'}
    payload.update(changes)
    response = client.post('/api/sales', headers=headers, json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_lifespan_opens_and_closes_database_in_its_event_loop(tmp_path):
    app = create_app(tmp_path / 'db.sqlite3')
    assert not (tmp_path / 'db.sqlite3').exists()
    with TestClient(app, base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        assert (tmp_path / 'db.sqlite3').exists()
        response = client.get('/api/session')
        cookie = response.headers['set-cookie'].lower()
        assert 'httponly' in cookie and 'samesite=strict' in cookie
        assert client.get('/api/snapshot').json()['sales'] == []
    # The database was created/used on TestClient's loop thread and is now closed.
    from sadi_local.db import Database
    db = Database(tmp_path / 'db.sqlite3')
    assert db.connection.execute('PRAGMA user_version').fetchone()[0] == 1
    db.close()


def test_private_get_needs_session_and_mutations_need_csrf(tmp_path):
    app = create_app(tmp_path / 'db.sqlite3')
    with TestClient(app, base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        assert client.get('/api/snapshot').status_code == 401
        assert client.post('/api/customers', json={'name': 'Ana'}).status_code == 401
        csrf = client.get('/api/session').json()['csrfToken']
        assert client.post('/api/customers', json={'name': 'Ana'}).status_code == 403
        assert client.post('/api/customers', json={'name': 'Ana'}, headers={'X-SADI-CSRF': 'wrong'}).status_code == 403
        assert client.post('/api/customers', json={'name': 'Ana'}, headers={'X-SADI-CSRF': csrf}).status_code == 200
        assert len(client.get('/api/snapshot').json()['customers']) == 1


def test_real_lan_peer_cannot_admin_even_with_stolen_cookie_csrf_or_forwarded_ip(api):
    client, headers, _ = api
    with peer(client, '192.168.1.40'):
        forwarded = headers | {'X-Forwarded-For': '127.0.0.1', 'Forwarded': 'for=127.0.0.1'}
        for path in ('/api/session', '/api/snapshot', '/api/backup', '/api/mobile/config', '/api/drafts/pos'):
            assert client.get(path, headers=forwarded).status_code == 403
        assert client.post('/api/customers', headers=forwarded, json={'name': 'Intruder'}).status_code == 403
    assert client.get('/api/snapshot').json()['customers'] == []


def test_origin_fetch_site_and_host_rebinding_are_rejected(api):
    client, headers, _ = api
    assert client.get('/api/session', headers={'Origin': 'http://attacker.invalid'}).status_code == 403
    assert client.get('/api/snapshot', headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403
    assert client.post('/api/customers', json={'name': 'Ana'},
        headers=headers | {'Origin': 'http://localhost:9999'}).status_code == 403
    assert client.get('/api/session', headers={'Host': 'evil.invalid'}).status_code == 400
    assert client.post('/api/customers', json={'name': 'Ana'},
        headers=headers | {'Origin': 'http://localhost:8765'}).status_code == 200


def test_api_security_headers_and_no_store_even_on_denials(api):
    client, _, _ = api
    for response in (client.get('/api/snapshot'), client.get('/api/mobile/reports')):
        assert response.headers['cache-control'] == 'no-store'
        assert response.headers['referrer-policy'] == 'no-referrer'
        assert "frame-ancestors 'none'" in response.headers['content-security-policy']
        assert response.headers['x-content-type-options'] == 'nosniff'
        assert 'access-control-allow-origin' not in response.headers


def test_streamed_request_body_limit_cannot_be_bypassed_without_content_length(api, monkeypatch):
    import sadi_local.web as web
    client, headers, _ = api
    monkeypatch.setattr(web, 'MAX_API_BODY_BYTES', 100)
    oversized = iter((b'{"draft":{"notes":"', b'x' * 200, b'"}}'))
    response = client.post('/api/drafts/pos', headers=headers, content=oversized)
    assert response.status_code == 413
    assert response.headers['cache-control'] == 'no-store'
    assert client.get('/api/drafts/pos').json()['draft'] is None
    assert client.post('/api/drafts/pos', headers=headers, json={'draft': {'notes': 'ok'}}).status_code == 200


@pytest.mark.parametrize('length', ['-1', 'invalid'])
def test_invalid_content_length_fails_before_processing(api, length):
    client, headers, _ = api
    response = client.post('/api/customers', headers=headers | {'Content-Length': length}, json={'name': 'Ana'})
    assert response.status_code == 400
    assert client.get('/api/snapshot').json()['customers'] == []


def test_pairing_stores_only_hash_and_mobile_report_contains_only_aggregates(api):
    client, headers, tmp_path = api
    identifier = variant(client, headers)
    customer = client.post('/api/customers', headers=headers, json={'name': 'Ana Privada', 'phone': '5491111111111'}).json()['id']
    created = sale(client, headers, identifier, customerId=customer)
    pair = client.post('/api/mobile/pair', headers=headers).json()
    assert len(pair['token']) >= 40
    assert pair['urls'] == ['http://192.168.1.20:8765/mobile#token=' + pair['token']]
    assert '?token=' not in pair['urls'][0]
    assert pair['qrSvg'] is None or '<svg' in pair['qrSvg']
    auth_file = (tmp_path / 'web-auth.json').read_text()
    assert pair['token'] not in auth_file
    assert json.loads(auth_file)['token_sha256'] == hashlib.sha256(pair['token'].encode()).hexdigest()
    with peer(client, '192.168.1.40'):
        response = client.get('/api/mobile/reports?month=2026-10', headers={'Authorization': 'Bearer ' + pair['token']})
        assert response.status_code == 200
        data = response.json()
        assert data['revenue_cents'] == 360000
        assert data['cogs_cents'] == 240000
        assert data['net_profit_cents'] == 84200
        assert data['daily'] and data['channels']
        assert 'incomplete_order_ids' not in data
        for private in ('Ana Privada', '5491111111111', identifier, created['id'], customer):
            assert private not in response.text
        assert client.get('/api/snapshot', headers={'Authorization': 'Bearer ' + pair['token']}).status_code == 403
        assert client.post('/api/sales', headers=headers | {'Authorization': 'Bearer ' + pair['token']}, json={}).status_code == 403
        assert client.post('/api/mobile/pair', headers=headers).status_code == 403
        assert client.get('/api/mobile/reports?month=2026-10&token=' + pair['token']).status_code == 401


def test_rotation_revoke_and_server_restart_preserve_only_current_mobile_credential(api):
    client, headers, tmp_path = api
    first = client.post('/api/mobile/pair', headers=headers).json()['token']
    second = client.post('/api/mobile/pair', headers=headers).json()['token']
    assert first != second
    with peer(client, '192.168.1.40'):
        assert client.get('/api/mobile/reports', headers={'Authorization': 'Bearer ' + first}).status_code == 401
        assert client.get('/api/mobile/reports', headers={'Authorization': 'Bearer ' + second}).status_code == 200
    client.post('/api/mobile/revoke', headers=headers)
    with peer(client, '192.168.1.40'):
        assert client.get('/api/mobile/reports', headers={'Authorization': 'Bearer ' + second}).status_code == 401
    assert json.loads((tmp_path / 'web-auth.json').read_text())['token_sha256'] is None


def test_mobile_hash_survives_restart_but_admin_cookie_does_not(tmp_path):
    path = tmp_path / 'restart.sqlite3'
    app = create_app(path, allow_mobile=True)
    with TestClient(app, base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        csrf = client.get('/api/session').json()['csrfToken']
        old_cookie = client.cookies.get('sadi_session')
        token = client.post('/api/mobile/pair', headers={'X-SADI-CSRF': csrf}).json()['token']
    restarted = create_app(path, allow_mobile=True)
    with TestClient(restarted, base_url='http://localhost', client=('192.168.1.40', 1)) as client:
        assert client.get('/api/mobile/reports', headers={'Authorization': 'Bearer ' + token}).status_code == 200
        with peer(client, '127.0.0.1'):
            client.cookies.set('sadi_session', old_cookie, domain='localhost.local', path='/')
            assert client.get('/api/snapshot').status_code == 401


def test_mobile_disabled_never_pairs_or_serves_a_report(tmp_path):
    with TestClient(create_app(tmp_path / 'db.sqlite3'), base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        csrf = client.get('/api/session').json()['csrfToken']
        assert client.get('/api/mobile/config').json()['enabled'] is False
        assert client.post('/api/mobile/pair', headers={'X-SADI-CSRF': csrf}).status_code == 400
        assert client.get('/api/mobile/reports', headers={'Authorization': 'Bearer whatever'}).status_code == 403


def test_schema_money_is_strict_and_invalid_date_rolls_back(api):
    client, headers, _ = api
    payload = {'name': 'Valentina', 'category': 'Conjuntos', 'sku': 'V', 'size': '95', 'color': 'Rojo',
               'cost': 100, 'retailPrice': 200, 'wholesalePrice': 150, 'stock': 1, 'minStock': 1}
    for value in (True, 100.5, '100', -1):
        assert client.post('/api/variants', headers=headers, json=payload | {'cost': value}).status_code == 422
    v = variant(client, headers, stock=1)
    before = client.get('/api/snapshot').json()
    invalid = {'variantId': v, 'quantity': 1, 'totalCost': 100, 'date': '2026-02-30'}
    assert client.post('/api/inventory/receive', headers=headers, json=invalid).status_code == 400
    assert client.get('/api/snapshot').json() == before


def test_out_of_stock_sale_rollback_and_checkout_idempotency(api):
    client, headers, _ = api
    v = variant(client, headers, stock=1)
    body = {'date': '2026-10-01', 'channel': 'Local', 'paymentMethod': 'Efectivo',
            'items': [{'variantId': v, 'quantity': 2, 'unitPrice': 200000}], 'commandId': 'bad-stock'}
    before = client.get('/api/snapshot').json()
    assert client.post('/api/sales', headers=headers, json=body).status_code == 400
    assert client.get('/api/snapshot').json() == before
    body['items'][0]['quantity'] = 1
    body['commandId'] = 'once'
    first = client.post('/api/sales', headers=headers, json=body)
    second = client.post('/api/sales', headers=headers, json=body)
    assert first.status_code == second.status_code == 200
    assert first.json()['id'] == second.json()['id']
    assert client.get('/api/snapshot').json()['variants'][0]['stock'] == 0
    assert len(client.get('/api/snapshot').json()['sales']) == 1


def test_reserve_complete_return_refund_and_period_reports(api):
    client, headers, _ = api
    v = variant(client, headers, stock=3)
    reserved = sale(client, headers, v, status='reserved')
    assert reserved['status'] == 'reserved' and reserved['costTotal'] is None
    snapshot = client.get('/api/snapshot').json()
    assert (snapshot['variants'][0]['stock'], snapshot['variants'][0]['reserved'], snapshot['variants'][0]['available']) == (3, 2, 1)
    assert not snapshot['payments']
    assert len(snapshot['movements']) == 1  # Reservation events are not fake physical movements.
    completed = client.post(f"/api/sales/{reserved['id']}/complete", headers=headers, json={'date': '2026-10-02', 'commandId': 'complete-once'})
    assert completed.status_code == 200
    assert completed.json()['costTotal'] == 240000
    assert client.post(f"/api/sales/{reserved['id']}/cancel", headers=headers, json={'date': '2026-11-01'}).status_code == 400
    cancelled = client.post(f"/api/sales/{reserved['id']}/cancel", headers=headers,
        json={'date': '2026-11-01', 'confirmReturn': True, 'commandId': 'return-once'})
    assert cancelled.status_code == 200 and cancelled.json()['status'] == 'void'
    assert cancelled.json()['balance'] == -360000
    assert client.get('/api/reports/monthly?month=2026-10').json()['net_profit_cents'] == 84200
    assert client.get('/api/reports/monthly?month=2026-11').json()['revenue_cents'] == -360000
    refunded = client.post(f"/api/sales/{reserved['id']}/refund", headers=headers,
        json={'amount': 360000, 'method': 'Transferencia', 'date': '2026-11-02'})
    assert refunded.status_code == 200 and refunded.json()['balance'] == 0
    assert len(refunded.json()['items']) == 1
    assert client.get('/api/snapshot').json()['variants'][0]['stock'] == 3


def test_receipt_payment_expense_draft_and_cash_closing_endpoints(api):
    client, headers, _ = api
    v = variant(client, headers, stock=0)
    purchase = client.post('/api/inventory/receive', headers=headers,
        json={'variantId': v, 'quantity': 2, 'totalCost': 240000, 'date': '2026-10-01', 'paid': False}).json()['id']
    assert client.get('/api/purchases').json()[0]['paid'] is False
    settled = client.post(f'/api/purchases/{purchase}/pay', headers=headers,
        json={'method': 'Efectivo', 'date': '2026-10-02'})
    assert settled.status_code == 200
    assert client.get('/api/purchases').json()[0]['paid'] is True
    expense = client.post('/api/expenses', headers=headers,
        json={'date': '2026-10-02', 'category': 'Publicidad', 'description': 'Anuncio', 'amount': 5000,
              'paymentMethod': 'Efectivo', 'paid': False}).json()['id']
    assert client.post(f'/api/expenses/{expense}/pay', headers=headers,
        json={'method': 'Efectivo', 'date': '2026-10-02'}).status_code == 200
    report = client.get('/api/reports/daily?date=2026-10-02&opening=300000').json()
    assert report['expected_cash_cents'] == 55000
    assert client.post('/api/cash-close', headers=headers,
        json={'date': '2026-10-02', 'openingCash': 300000, 'countedCash': 55000}).status_code == 200
    draft = {'cart': [{'variantId': v, 'quantity': 1}], 'commission': '3'}
    assert client.post('/api/drafts/pos', headers=headers, json={'draft': draft}).status_code == 200
    assert client.get('/api/drafts/pos').json()['draft'] == draft
    assert client.post('/api/drafts/pos', headers=headers, json={'draft': None}).status_code == 200
    assert client.get('/api/drafts/pos').json()['draft'] is None


def test_static_fallback_never_serves_the_index_for_api_or_outside_files(tmp_path):
    static = tmp_path / 'dist'; static.mkdir()
    (static / 'index.html').write_text('<h1>Sou Linda System</h1>')
    (static / 'app.js').write_text('console.log("local")')
    (tmp_path / 'private.txt').write_text('private database path')
    app = create_app(tmp_path / 'db.sqlite3', static_dir=static)
    with TestClient(app, base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        client.get('/api/session')
        assert client.get('/').status_code == 200
        assert client.get('/mobile').status_code == 200
        assert client.get('/app.js').status_code == 200
        missing = client.get('/api/does-not-exist')
        assert missing.status_code == 404 and '<h1>' not in missing.text
        outside = client.get('/%2e%2e/private.txt')
        assert outside.status_code == 404 and 'private database path' not in outside.text
        assert client.get('/missing.js').status_code == 404


def test_config_disallows_wildcard_hosts_and_non_http_report_urls(tmp_path):
    with pytest.raises(ValueError):
        create_app(tmp_path / 'db.sqlite3', allowed_hosts=['*'])
    with pytest.raises(ValueError):
        create_app(tmp_path / 'db.sqlite3', report_addresses=['javascript:alert(1)'])
