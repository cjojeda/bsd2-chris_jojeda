"""Notebook-only administration and explicitly paired LAN aggregate reports.

The real ASGI peer is authoritative. Forwarded IP headers never grant admin
access. SQLite is opened in lifespan and all database routes are async handlers
on that same event-loop thread, never FastAPI's synchronous worker pool.
"""
from contextlib import asynccontextmanager
from datetime import date
import hashlib
import hmac
import io
import ipaddress
import json
import logging
import os
from pathlib import Path
import re
import secrets
import sqlite3
import tempfile
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import __version__
from .db import Database
from .currency import currency_code, initialize_business_currency, validate_amount
from .demo import seed_demo
from .reports import close_cash, daily_report, monthly_report
from .services import SadiService
from .web_bridge import normalize_purchase, normalize_sale, normalize_snapshot
from .web_models import (
    AdjustmentRequest, CancelRequest, CashClosingRequest, CommandRequest, CustomerRequest,
    DraftRequest, ExpenseRequest, PaymentRequest, ReceiveRequest, RefundRequest, ReturnRequest,
    SaleRequest, SettleRequest, VariantRequest,
)
from .web_transfer import build_transfer_router

SESSION_COOKIE = 'sadi_session'
CSRF_HEADER = 'X-SADI-CSRF'
MUTATING_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}
MAX_API_BODY_BYTES = 12 * 1024 * 1024
MAX_IMPORT_BODY_BYTES = 15 * 1024 * 1024
MAX_BACKUP_BODY_BYTES = 110 * 1024 * 1024
LOG = logging.getLogger(__name__)
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; "
       "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")


def _loopback(request: Request) -> bool:
    if request.client is None:
        return False
    try:
        address = ipaddress.ip_address(request.client.host)
        mapped = getattr(address, 'ipv4_mapped', None)
        return bool(mapped.is_loopback if mapped is not None else address.is_loopback)
    except ValueError:
        return False


def _same_secret(candidate, expected) -> bool:
    return hmac.compare_digest(str(candidate or '').encode('utf-8'), str(expected).encode('utf-8'))


def _same_origin(request: Request) -> bool:
    if request.headers.get('sec-fetch-site', '').lower() == 'cross-site':
        return False
    origin = request.headers.get('origin')
    if not origin:
        return True  # Native local clients still need the unpredictable session/CSRF secrets.
    try:
        parsed = urlsplit(origin)
        if parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
            return False
        effective_port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        target_port = request.url.port or (443 if request.url.scheme == 'https' else 80)
        return (parsed.scheme.lower(), (parsed.hostname or '').lower(), effective_port) == (
            request.url.scheme.lower(), (request.url.hostname or '').lower(), target_port)
    except ValueError:
        return False


def _host_config(allowed_hosts, report_addresses):
    hosts = {'localhost', '127.0.0.1'}
    for supplied in allowed_hosts or ():
        value = str(supplied).strip().lower()
        if not value or '*' in value or '/' in value or '@' in value:
            raise ValueError('Los hosts permitidos deben ser nombres o IP exactos, sin comodines ni rutas.')
        try:
            hosts.add(str(ipaddress.ip_address(value.strip('[]'))))
        except ValueError:
            if not re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)*', value):
                raise ValueError('Host permitido inválido; no incluyas protocolo ni puerto.') from None
            hosts.add(value)
    addresses = []
    for supplied in report_addresses or ():
        parsed = urlsplit(str(supplied).rstrip('/'))
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password
                or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise ValueError('La dirección de reportes debe ser una URL base HTTP/HTTPS sin ruta ni credenciales.')
        try:
            parsed.port
        except ValueError:
            raise ValueError('Puerto inválido en la dirección de reportes.') from None
        hosts.add(parsed.hostname.lower())
        addresses.append(f'{parsed.scheme}://{parsed.netloc}')
    return sorted(hosts), list(dict.fromkeys(addresses))


def _read_mobile_hash(path):
    if path is None or not path.exists():
        return None
    try:
        value = json.loads(path.read_text(encoding='utf-8'))
        digest = value.get('token_sha256')
        if value.get('version') != 1 or (digest is not None and not re.fullmatch(r'[0-9a-f]{64}', digest)):
            raise ValueError('Formato de credencial móvil inválido.')
        return digest
    except (OSError, ValueError, TypeError, AttributeError):
        # Fail closed. An invalid auth file must never yield a usable credential.
        LOG.warning('La vinculación móvil no pudo cargarse; es necesario vincular nuevamente.')
        return None


def _save_mobile_hash(path, digest):
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.web-auth-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            json.dump({'version': 1, 'token_sha256': digest}, handle, separators=(',', ':'))
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _qr_svg(url):
    try:
        import qrcode
        from qrcode.image.svg import SvgPathImage
        image = qrcode.make(url, image_factory=SvgPathImage, box_size=8, border=3)
        output = io.BytesIO()
        image.save(output)
        return output.getvalue().decode('utf-8')
    except ImportError:
        return None


def _mobile_projection(report):
    """An allowlist prevents future report fields from accidentally exposing PII."""
    scalar_keys = ('month', 'currency', 'revenue_cents', 'cogs_cents', 'commission_cents', 'shipping_cents',
        'packaging_cents', 'operating_cents', 'loss_cents', 'gross_profit_cents', 'net_profit_cents',
        'known_result_cents', 'incomplete_cost_count', 'sales_count', 'average_ticket_cents',
        'new_sales_cents', 'discount_cents', 'shared_expense_cents', 'unallocated_expense_cents',
        'allocation_mode', 'previous_revenue_cents', 'outstanding_cents', 'customer_credit_cents', 'advances_cents')
    channel_keys = ('channel', 'revenue_cents', 'cogs_cents', 'commission_cents', 'shipping_cents',
        'packaging_cents', 'attributed_expense_cents', 'contribution_cents', 'shared_allocated_cents',
        'profit_cents', 'incomplete_cost_count', 'sales_count')
    result = {key: report[key] for key in scalar_keys if key in report}
    result['channels'] = [{key: row[key] for key in channel_keys if key in row} for row in report['channels']]
    result['daily'] = [{'date': row['date'], 'total_cents': row['total_cents']} for row in report['daily']]
    return result


def create_app(db_path, static_dir=None, allow_mobile=False, allowed_hosts=None, report_addresses=None, beta_mode=False):
    # Browsers share cookies across ports on a host. Give the test edition its
    # own cookie so it can run beside the normal notebook application.
    session_cookie = 'sadi_beta_session' if beta_mode else SESSION_COOKIE
    allowed, addresses = _host_config(allowed_hosts, report_addresses)
    database_path = str(db_path)
    auth_path = None if database_path == ':memory:' else Path(db_path).resolve().parent / 'web-auth.json'
    frontend = Path(static_dir).resolve() if static_dir is not None else None

    @asynccontextmanager
    async def lifespan(app):
        db = Database(database_path)
        try:
            initialize_business_currency(db)
            app.state.db = db
            app.state.service = SadiService(db)
            app.state.session_token = secrets.token_urlsafe(32)
            app.state.csrf_token = secrets.token_urlsafe(32)
            app.state.mobile_hash = _read_mobile_hash(auth_path)
            app.state.mobile_auth_path = auth_path
            app.state.allow_mobile = bool(allow_mobile)
            app.state.report_addresses = addresses
            yield
        finally:
            db.close()

    app = FastAPI(title='Sou Linda System', version=__version__, lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.allow_mobile = bool(allow_mobile)
    app.state.report_addresses = addresses
    app.state.beta_mode = bool(beta_mode)

    async def require_admin(request: Request):
        if not _loopback(request):
            raise HTTPException(403, 'La administración está disponible únicamente desde la notebook.')
        if not _same_origin(request):
            raise HTTPException(403, 'Origen de solicitud no permitido.')
        if not _same_secret(request.cookies.get(session_cookie), request.app.state.session_token):
            raise HTTPException(401, 'Abrí Sou Linda System desde la notebook para iniciar la sesión local.')
        if request.method in MUTATING_METHODS and not _same_secret(request.headers.get(CSRF_HEADER), request.app.state.csrf_token):
            raise HTTPException(403, 'La sesión de escritura no es válida. Recargá Sou Linda System.')
        return True

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed, www_redirect=False)

    @app.middleware('http')
    async def security_headers(request, call_next):
        try:
            if request.url.path.startswith('/api/'):
                is_session = request.method == 'GET' and request.url.path == '/api/session'
                is_report = request.method == 'GET' and request.url.path == '/api/mobile/reports'
                if not is_session and not is_report:
                    await require_admin(request)
                length = request.headers.get('content-length')
                limit = MAX_API_BODY_BYTES
                if request.url.path in ('/api/imports/inspect', '/api/imports/preview'):
                    limit = MAX_IMPORT_BODY_BYTES  # 10 MiB plus the base64/JSON envelope.
                elif request.url.path in ('/api/backup/validate', '/api/backup/restore'):
                    limit = MAX_BACKUP_BODY_BYTES  # Router validates decoded size separately.
                if length:
                    if int(length) < 0:
                        raise HTTPException(400, 'Tamaño de solicitud inválido.')
                    if int(length) > limit:
                        raise HTTPException(413, 'El archivo o la solicitud supera el tamaño permitido.')
                if request.method in MUTATING_METHODS:
                    # Content-Length can be omitted for chunked requests. Count
                    # actual bytes before a JSON parser can allocate the whole
                    # document, then replay the bounded body to the route. This
                    # is the same Request body cache used by Request.body().
                    body = bytearray()
                    async for chunk in request.stream():
                        if len(body) + len(chunk) > limit:
                            raise HTTPException(413, 'El archivo o la solicitud supera el tamaño permitido.')
                        body.extend(chunk)
                    request._body = bytes(body)
            response = await call_next(request)
        except HTTPException as error:
            response = JSONResponse({'detail': error.detail}, status_code=error.status_code, headers=error.headers)
        except ValueError:
            response = JSONResponse({'detail': 'La solicitud contiene un encabezado inválido.'}, status_code=400)
        except Exception as error:
            LOG.error('No se pudo completar la solicitud local (%s).', type(error).__name__)
            response = JSONResponse({'detail': 'No se pudo completar la operación. No vuelvas a confirmar sin revisar su estado.'}, status_code=500)
        response.headers['Content-Security-Policy'] = CSP
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        if request.url.path.startswith('/api/') or request.url.path == '/mobile':
            response.headers['Cache-Control'] = 'no-store'
            response.headers['Pragma'] = 'no-cache'
        return response

    @app.exception_handler(ValueError)
    async def domain_error(request, error):
        return JSONResponse({'detail': str(error)}, status_code=400)

    @app.exception_handler(sqlite3.IntegrityError)
    async def integrity_error(request, error):
        return JSONResponse({'detail': 'La operación incumple una restricción; no se guardaron cambios.'}, status_code=409)

    @app.exception_handler(sqlite3.OperationalError)
    async def sqlite_error(request, error):
        LOG.error('No se pudo completar una operación SQLite (%s).', type(error).__name__)
        return JSONResponse({'detail': 'No se pudo acceder a la base local. Revisá el espacio y volvé a intentar.'}, status_code=503)

    @app.get('/api/session')
    async def session(request: Request):
        if not _loopback(request) or not _same_origin(request):
            raise HTTPException(403, 'La sesión de administración solo se abre desde la notebook.')
        response = JSONResponse({'csrfToken': request.app.state.csrf_token})
        response.set_cookie(session_cookie, request.app.state.session_token, httponly=True,
                            samesite='strict', secure=request.url.scheme == 'https', path='/')
        return response

    @app.get('/api/snapshot', dependencies=[Depends(require_admin)])
    async def snapshot(request: Request):
        result = normalize_snapshot(request.app.state.db, request.app.state.service)
        # The edition belongs to this running server, never to a restored file.
        # Keeping it out of SQLite also keeps a beta-only label out of backups.
        result['settings'] = [setting for setting in result['settings'] if setting['key'] != 'runtime_mode']
        result['settings'].append({'key': 'runtime_mode',
                                   'value': 'beta' if request.app.state.beta_mode else 'standard'})
        return result

    @app.get('/api/sales/{sale_id}', dependencies=[Depends(require_admin)])
    async def sale_detail(sale_id: str, request: Request):
        return normalize_sale(request.app.state.service, sale_id)

    @app.post('/api/variants', dependencies=[Depends(require_admin)])
    async def save_variant(body: VariantRequest, request: Request):
        service = request.app.state.service
        data = dict(model=body.name, category=body.category, sku=body.sku, size=body.size, color=body.color,
                    retail_cents=body.retailPrice, wholesale_cents=body.wholesalePrice,
                    min_stock=body.minStock, active=body.active)
        if body.productId is not None:
            data['product_id'] = body.productId
        if body.variantId is not None:
            current = next((row for row in service.list_variants() if row['id'] == body.variantId), None)
            if current is None:
                raise HTTPException(404, 'La variante ya no existe.')
            if body.stock != current['on_hand'] or body.cost != current['cpp_cents']:
                raise ValueError('Para cambiar stock o costo usá una entrada o un ajuste de inventario.')
            data['id'] = body.variantId
        else:
            data.update(initial_qty=body.stock, initial_unit_cost_cents=body.cost)
        identifier = service.save_variant(data)
        return {'id': identifier}

    @app.post('/api/inventory/receive', dependencies=[Depends(require_admin)])
    async def receive(body: ReceiveRequest, request: Request):
        identifier = request.app.state.service.receive_stock(body.variantId, body.quantity, body.totalCost,
            note=body.note, business_date=body.date, command_id=body.commandId,
            paid=body.paid, payment_method=body.paymentMethod)
        return {'id': identifier}

    @app.post('/api/inventory/adjust', dependencies=[Depends(require_admin)])
    async def adjust(body: AdjustmentRequest, request: Request):
        identifier = request.app.state.service.adjust_stock(body.variantId, body.delta, body.note,
            total_cost_cents=body.totalCost, business_date=body.date, command_id=body.commandId)
        return {'id': identifier}

    @app.get('/api/purchases', dependencies=[Depends(require_admin)])
    async def purchases(request: Request):
        with request.app.state.db.transaction():
            data = request.app.state.db.snapshot()
            variants = {row['id']: row for row in request.app.state.service.list_variants()}
            return [normalize_purchase(row, variants) for row in data['purchases']]

    @app.post('/api/purchases/{purchase_id}/pay', dependencies=[Depends(require_admin)])
    async def pay_purchase(purchase_id: str, body: SettleRequest, request: Request):
        identifier = request.app.state.service.pay_purchase(purchase_id, body.method,
            business_date=body.date, command_id=body.commandId)
        return {'id': identifier}

    @app.post('/api/customers', dependencies=[Depends(require_admin)])
    async def save_customer(body: CustomerRequest, request: Request):
        identifier = request.app.state.service.save_customer(body.name, body.phone, body.social,
            body.preferredSize, customer_id=body.id)
        return {'id': identifier}

    @app.post('/api/sales', dependencies=[Depends(require_admin)])
    async def create_sale(body: SaleRequest, request: Request):
        service = request.app.state.service
        identifier = service.create_order(
            [{'variant_id': row.variantId, 'quantity': row.quantity, 'unit_price_cents': row.unitPrice} for row in body.items],
            body.channel, customer_id=body.customerId, discount_kind=body.discountKind,
            discount_value=body.discountValue if body.discountValue is not None else body.discount,
            commission_bps=body.commissionRate, shipping_cents=body.shippingCost,
            packaging_cents=body.packagingCost, payment_method=body.paymentMethod,
            payment_terms='credit' if body.paymentMethod == 'Crédito' else 'immediate',
            business_date=body.date, status=body.status, command_id=body.commandId, notes=body.notes,
            direct_cost_method=body.directCostMethod, direct_costs_paid=body.directCostsPaid)
        return normalize_sale(service, identifier)

    def add_stage_action(action, service_name):
        async def endpoint(sale_id: str, body: CommandRequest, request: Request):
            service = request.app.state.service
            getattr(service, service_name)(sale_id, command_id=body.commandId, business_date=body.date)
            return normalize_sale(service, sale_id)
        app.add_api_route(f'/api/sales/{{sale_id}}/{action}', endpoint, methods=['POST'],
                          dependencies=[Depends(require_admin)], name=f'sale_{action}')

    for action, method in (('reserve', 'reserve_order'), ('release', 'release_reservation'), ('complete', 'complete_order')):
        add_stage_action(action, method)

    @app.post('/api/sales/{sale_id}/cancel', dependencies=[Depends(require_admin)])
    async def cancel_sale(sale_id: str, body: CancelRequest, request: Request):
        service = request.app.state.service
        service.cancel_order(sale_id, confirm_return=body.confirmReturn, command_id=body.commandId, business_date=body.date)
        return normalize_sale(service, sale_id)

    @app.post('/api/sales/{sale_id}/return', dependencies=[Depends(require_admin)])
    async def return_sale(sale_id: str, body: ReturnRequest, request: Request):
        service = request.app.state.service
        service.return_order(sale_id, body.items, business_date=body.date, command_id=body.commandId)
        return normalize_sale(service, sale_id)

    @app.post('/api/sales/{sale_id}/payment', dependencies=[Depends(require_admin)])
    async def pay_sale(sale_id: str, body: PaymentRequest, request: Request):
        service = request.app.state.service
        service.record_payment(sale_id, body.amount, body.method, commission_bps=body.commissionRate,
                               business_date=body.date, command_id=body.commandId)
        return normalize_sale(service, sale_id)

    @app.post('/api/sales/{sale_id}/refund', dependencies=[Depends(require_admin)])
    async def refund_sale(sale_id: str, body: RefundRequest, request: Request):
        service = request.app.state.service
        service.record_refund(sale_id, body.amount, body.method, business_date=body.date, command_id=body.commandId)
        return normalize_sale(service, sale_id)

    @app.post('/api/sales/{sale_id}/direct-costs/pay', dependencies=[Depends(require_admin)])
    async def pay_direct_costs(sale_id: str, body: SettleRequest, request: Request):
        service = request.app.state.service
        service.pay_direct_costs(sale_id, body.method, business_date=body.date, command_id=body.commandId)
        return normalize_sale(service, sale_id)

    @app.post('/api/expenses', dependencies=[Depends(require_admin)])
    async def expense(body: ExpenseRequest, request: Request):
        identifier = request.app.state.service.save_expense(body.date, body.category, body.description,
            body.amount, body.paymentMethod, channel=body.channel, cost_type=body.costType,
            paid=body.paid, command_id=body.commandId)
        return {'id': identifier}

    @app.post('/api/expenses/{expense_id}/pay', dependencies=[Depends(require_admin)])
    async def settle_expense(expense_id: str, body: SettleRequest, request: Request):
        identifier = request.app.state.service.pay_expense(expense_id, body.method,
            business_date=body.date, command_id=body.commandId)
        return {'id': identifier}

    @app.get('/api/reports/monthly', dependencies=[Depends(require_admin)])
    async def monthly(request: Request, month: str | None = None, allocate_shared: bool = False):
        db = request.app.state.db
        return monthly_report(db, month or date.today().strftime('%Y-%m'), allocate_shared) | {'currency': currency_code(db)}

    @app.get('/api/reports/daily', dependencies=[Depends(require_admin)])
    async def daily(request: Request, date: str | None = None, opening: int = 0):
        from datetime import date as local_date
        db = request.app.state.db
        validate_amount(db, opening, 'Fondo inicial')
        return daily_report(db, date or local_date.today().isoformat(), opening) | {'currency': currency_code(db)}

    @app.post('/api/cash-close', dependencies=[Depends(require_admin)])
    async def cash_close(body: CashClosingRequest, request: Request):
        db = request.app.state.db
        validate_amount(db, body.openingCash, 'Fondo inicial')
        validate_amount(db, body.countedCash, 'Efectivo contado')
        return close_cash(db, body.date, body.openingCash, body.countedCash,
                          body.note, allow_revision=body.allowRevision)

    @app.get('/api/drafts/pos', dependencies=[Depends(require_admin)])
    async def get_draft(request: Request):
        return {'draft': request.app.state.db.load_draft('pos')}

    @app.post('/api/drafts/pos', dependencies=[Depends(require_admin)])
    async def save_draft(body: DraftRequest, request: Request):
        if body.draft is None:
            request.app.state.db.delete_draft('pos')
        else:
            request.app.state.db.save_draft('pos', body.draft)
        return {'saved': True}

    @app.post('/api/demo', dependencies=[Depends(require_admin)])
    async def demo(request: Request):
        seed_demo(request.app.state.service)
        return {'loaded': True}

    @app.get('/api/mobile/config', dependencies=[Depends(require_admin)])
    async def mobile_config(request: Request):
        return {'enabled': request.app.state.allow_mobile,
                'paired': bool(request.app.state.allow_mobile and request.app.state.mobile_hash),
                'reportAddresses': [f'{base}/mobile' for base in request.app.state.report_addresses]}

    @app.post('/api/mobile/pair', dependencies=[Depends(require_admin)])
    async def pair_mobile(request: Request):
        if not request.app.state.allow_mobile:
            raise HTTPException(400, 'Iniciá Sou Linda System con acceso móvil habilitado para vincular el celular.')
        token = secrets.token_urlsafe(32)  # 256 random bits; never stored in clear text.
        digest = hashlib.sha256(token.encode('ascii')).hexdigest()
        _save_mobile_hash(request.app.state.mobile_auth_path, digest)
        request.app.state.mobile_hash = digest
        urls = [f'{base}/mobile#token={token}' for base in request.app.state.report_addresses]
        return {'enabled': True, 'paired': True, 'token': token, 'urls': urls,
                'qrSvg': _qr_svg(urls[0]) if urls else None}

    @app.post('/api/mobile/revoke', dependencies=[Depends(require_admin)])
    async def revoke_mobile(request: Request):
        _save_mobile_hash(request.app.state.mobile_auth_path, None)
        request.app.state.mobile_hash = None
        return {'enabled': request.app.state.allow_mobile, 'paired': False}

    @app.get('/api/mobile/reports')
    async def mobile_reports(request: Request, month: str | None = None, allocate_shared: bool = False):
        if not request.app.state.allow_mobile:
            raise HTTPException(403, 'El acceso móvil no está habilitado.')
        authorization = request.headers.get('authorization', '')
        scheme, _, candidate = authorization.partition(' ')
        if scheme.lower() != 'bearer' or not candidate or len(candidate) > 512:
            raise HTTPException(401, 'Vinculá este celular desde la notebook.')
        stored = request.app.state.mobile_hash
        digest = hashlib.sha256(candidate.encode('utf-8')).hexdigest()
        if not stored or not _same_secret(digest, stored):
            raise HTTPException(401, 'La vinculación venció o fue revocada. Volvé a vincular el celular.')
        db = request.app.state.db
        report = monthly_report(db, month or date.today().strftime('%Y-%m'), allocate_shared) | {'currency': currency_code(db)}
        return _mobile_projection(report)

    # Backups/imports are required features. A broken installation must fail
    # at startup rather than silently starting without its transfer module.
    app.include_router(build_transfer_router(require_admin))

    @app.get('/{path:path}')
    async def frontend_file(path: str, request: Request):
        if path == 'api' or path.startswith('api/'):
            raise HTTPException(404, 'La ruta API no existe.')
        if frontend is None or not (frontend / 'index.html').is_file():
            raise HTTPException(404, 'La interfaz todavía no está compilada. Ejecutá npm run build.')
        target = (frontend / path).resolve()
        if not target.is_relative_to(frontend):
            raise HTTPException(404, 'Archivo no encontrado.')
        if path and target.is_file():
            return FileResponse(target)
        if path in ('', 'mobile', 'mobile/') or '.' not in Path(path).name:
            return FileResponse(frontend / 'index.html', headers={'Cache-Control': 'no-cache'})
        raise HTTPException(404, 'Archivo no encontrado.')

    return app
