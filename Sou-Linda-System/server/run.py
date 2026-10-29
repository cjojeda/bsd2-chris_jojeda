"""Sou Linda System: start the notebook-owned web application without Node.js."""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
from threading import Timer
import webbrowser

sys.path.insert(0, str(Path(__file__).resolve().parent / 'src'))
from sadi_local.db import Database
from sadi_local.maintenance import automatic_backup
from sadi_local.paths import data_directory

BETA_MARKER_NAME = 'sou-linda-beta.json'
BETA_MARKER_VERSION = 1
BETA_APPLICATION = 'Sou Linda System Beta'


def beta_data_directory() -> Path:
    production = data_directory().expanduser().resolve()
    return production.parent / f'{production.name or "SouLindaSystem"}Beta'


def _validate_beta_target(folder: Path) -> None:
    """Reject aliases of the real business before acquiring or creating a lock."""
    production = data_directory().expanduser().resolve()
    if os.path.normcase(str(folder.resolve())) == os.path.normcase(str(production)):
        raise RuntimeError('La beta no puede usar la carpeta del negocio real. Elegí otra carpeta de prueba.')
    database = folder / 'sou-linda.sqlite3'
    if any(Path(str(database) + suffix).is_symlink() for suffix in ('', '-wal', '-shm', '-journal')):
        raise RuntimeError('La beta no admite una base ni archivos auxiliares enlazados a otra carpeta.')
    real_database = production / 'sou-linda.sqlite3'
    for suffix in ('', '-wal', '-shm', '-journal'):
        candidate = Path(str(database) + suffix)
        real_candidate = Path(str(real_database) + suffix)
        if candidate.exists() and real_candidate.exists() and os.path.samefile(candidate, real_candidate):
            raise RuntimeError('La beta no puede abrir un enlace a la base ni a los archivos del negocio real.')


def _write_beta_marker(folder: Path, seeded: bool) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    marker = {'application': BETA_APPLICATION, 'version': BETA_MARKER_VERSION, 'seeded': seeded}
    descriptor, temporary = tempfile.mkstemp(prefix='.sou-linda-beta-', suffix='.tmp', dir=folder)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            json.dump(marker, handle, ensure_ascii=False, separators=(',', ':'))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, folder / BETA_MARKER_NAME)
    finally:
        Path(temporary).unlink(missing_ok=True)


def prepare_beta_database(folder: Path) -> Path:
    """Own a separate workspace and seed its PYG demo once, including crash recovery.

    Call while holding InstanceLock. The external marker survives a database
    restoration or an intentional clear. The transaction-local seed marker only
    recovers the brief window between committing the demo and saving its marker.
    """
    from sadi_local.currency import BUSINESS_TABLES, initialize_business_currency
    from sadi_local.demo import seed_demo
    from sadi_local.services import SadiService

    folder = folder.expanduser().resolve()
    _validate_beta_target(folder)
    path = folder / 'sou-linda.sqlite3'
    marker_path = folder / BETA_MARKER_NAME
    if marker_path.exists():
        if marker_path.stat().st_size > 4096:
            raise ValueError('La identificación de la beta es inválida. Elegí otra carpeta de prueba.')
        try:
            marker = json.loads(marker_path.read_text(encoding='utf-8'))
        except (OSError, ValueError) as error:
            raise ValueError('No se pudo leer la identificación de la beta. Elegí otra carpeta de prueba.') from error
        if (not isinstance(marker, dict) or marker.get('application') != BETA_APPLICATION
                or type(marker.get('version')) is not int or marker['version'] != BETA_MARKER_VERSION
                or type(marker.get('seeded')) is not bool):
            raise ValueError('Esta carpeta no está identificada como una beta compatible de Sou Linda.')
    else:
        if path.exists():
            raise RuntimeError('Esta carpeta ya contiene una base sin identificación de beta. Elegí una carpeta de prueba nueva.')
        # Persist ownership first. A crash during SQLite initialization can then
        # recover only this workspace rather than adopting an unknown database.
        _write_beta_marker(folder, False)
        marker = {'seeded': False}

    db = Database(path)
    try:
        if not marker['seeded']:
            with db.transaction():
                if db.get_meta('beta_seeded') != 'true':
                    populated = any(db.connection.execute(f'SELECT 1 FROM "{table}" LIMIT 1').fetchone()
                                    for table in BUSINESS_TABLES)
                    if populated:
                        raise RuntimeError('La preparación de la beta encontró datos ajenos a la demo. Elegí una carpeta nueva.')
                    if initialize_business_currency(db) != 'PYG':
                        raise RuntimeError('La beta nueva debe iniciar en guaraníes. Elegí una carpeta de prueba nueva.')
                    seed_demo(SadiService(db))
                    db.set_meta('beta_seeded', 'true')
            _write_beta_marker(folder, True)
        else:
            # Preserve any edits, clears, or restorations made during beta use.
            initialize_business_currency(db)
        automatic_backup(db, 'startup')
    finally:
        db.close()
    return path


class InstanceLock:
    """OS-owned lock is released even if Python crashes; no stale PID guessing."""
    def __init__(self, folder: Path):
        folder.mkdir(parents=True, exist_ok=True)
        self.handle = (folder / 'sou-linda.lock').open('a+b')
        self.handle.seek(0)
        if not self.handle.read(1):
            self.handle.write(b'0')
            self.handle.flush()
        self.handle.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.handle.close()
            raise RuntimeError('Sou Linda System ya está abierto para esta base. Usá su ventana o cerrá el motor anterior.') from None

    def close(self):
        if not self.handle.closed:
            self.handle.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            self.handle.close()


def lan_addresses() -> list[str]:
    """Inspect local interfaces without connecting to an Internet address."""
    found = set()
    try:
        records = socket.getaddrinfo(socket.gethostname(), None, family=socket.AF_INET)
    except OSError:
        return []
    for record in records:
        address = ipaddress.ip_address(record[4][0])
        if address.is_private and not address.is_loopback and not address.is_link_local and not address.is_unspecified:
            found.add(str(address))
    return sorted(found)


def self_test() -> int:
    """Use a disposable database; never seed or modify the real business."""
    from sadi_local.services import SadiService
    from sadi_local.reports import monthly_report
    from sadi_local.currency import initialize_business_currency
    from datetime import date
    with tempfile.TemporaryDirectory(prefix='sou-linda-check-') as folder:
        db = Database(Path(folder) / 'test.sqlite3')
        try:
            assert initialize_business_currency(db) == 'PYG'
            service = SadiService(db)
            variant = service.save_variant(dict(model='Verificación', category='Prueba', sku='TEST', size='95', color='Rojo',
                retail_cents=200000, wholesale_cents=150000, min_stock=1, initial_qty=10, initial_unit_cost_cents=100000))
            service.receive_stock(variant, 10, 1400000)
            order = service.create_order([dict(variant_id=variant, quantity=2, unit_price_cents=200000)], 'Instagram',
                discount_kind='percent', discount_value=1000, commission_bps=300, shipping_cents=20000, packaging_cents=5000)
            assert service.get_order(order)['net_profit_cents'] == 84200
            assert monthly_report(db, date.today().strftime('%Y-%m'))['net_profit_cents'] == 84200
            assert automatic_backup(db, 'verification') is not None
        finally:
            db.close()
    print('Sou Linda System: guaraníes PYG, SQLite, CPP, descuentos, rentabilidad y respaldo verificados.')
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Sou Linda System · motor local de la notebook')
    parser.add_argument('--mobile', action='store_true', help='Habilitar reportes de solo lectura en la red local; requiere vincular el celular.')
    parser.add_argument('--beta', action='store_true', help='Abrir la beta con demo y datos de prueba separados del negocio real.')
    parser.add_argument('--port', type=int)
    parser.add_argument('--view', choices=('classic', 'agile'),
                        help='Interfaz inicial: classic conserva la vista original; agile abre la alternativa Ágil.')
    parser.add_argument('--data-dir', type=Path, help='Carpeta de datos alternativa; permite pruebas aisladas.')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if args.port is None:
        args.port = 8766 if args.beta else 8765
    if args.view is None:
        args.view = 'agile' if args.beta else 'classic'
    if not 1024 <= args.port <= 65535:
        parser.error('El puerto debe estar entre 1024 y 65535.')
    frontend = Path(__file__).resolve().parents[1] / 'dist'
    if not (frontend / 'index.html').is_file():
        print('Falta la interfaz compilada en dist. Usá el paquete completo o ejecutá npm run build.', file=sys.stderr)
        return 1
    folder = (args.data_dir or (beta_data_directory() if args.beta else data_directory())).expanduser().resolve()
    lock = None
    timer = None
    database_ready = False
    try:
        if args.beta:
            _validate_beta_target(folder)
        lock = InstanceLock(folder)
        if args.beta:
            path = prepare_beta_database(folder)
        else:
            path = folder / 'sou-linda.sqlite3'
            db = Database(path)
            try:
                automatic_backup(db, 'startup')
            finally:
                db.close()
        database_ready = True
        from sadi_local.web import create_app
        import uvicorn
        addresses = lan_addresses() if args.mobile else []
        app = create_app(path, static_dir=frontend, allow_mobile=args.mobile, allowed_hosts=addresses,
                         report_addresses=[f'http://{host}:{args.port}' for host in addresses], beta_mode=args.beta)
        url = f'http://127.0.0.1:{args.port}' + ('/agil' if args.view == 'agile' else '')
        print(f'\nSou Linda System\nBase local: {path}\nAbrí el navegador en {url}\n')
        if args.beta:
            print('BETA DE PRUEBA · Esta carpeta conserva únicamente el entorno separado de pruebas.')
        print('Mantené esta ventana abierta. Para cerrar el motor presioná Ctrl+C.')
        if args.mobile:
            print('Reportes móviles habilitados. Vinculá el celular en Datos y respaldos.')
            if not addresses:
                print('No se detectó una IP privada. Revisá la conexión Wi-Fi y reiniciá el motor.')
        if not args.no_browser:
            timer = Timer(1.5, lambda: webbrowser.open(url))
            timer.daemon = True
            timer.start()
        uvicorn.run(app, host='0.0.0.0' if args.mobile else '127.0.0.1', port=args.port,
                    workers=1, proxy_headers=False, access_log=False, log_level='info')
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(f'No se pudo iniciar Sou Linda System: {error}', file=sys.stderr)
        return 1
    finally:
        if timer is not None:
            timer.cancel()
        if lock is not None:
            try:
                # This connection is opened only after the HTTP server closes its own.
                if database_ready and (folder / 'sou-linda.sqlite3').is_file():
                    db = Database(folder / 'sou-linda.sqlite3')
                    try:
                        automatic_backup(db, 'shutdown')
                    finally:
                        db.close()
            except Exception as error:
                print(f'No se pudo guardar el respaldo de cierre: {error}', file=sys.stderr)
            finally:
                lock.close()


if __name__ == '__main__':
    raise SystemExit(main())
