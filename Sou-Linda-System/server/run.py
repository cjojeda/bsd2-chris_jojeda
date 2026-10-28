"""Sou Linda System: start the notebook-owned web application without Node.js."""
from __future__ import annotations

import argparse
import ipaddress
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
    from datetime import date
    with tempfile.TemporaryDirectory(prefix='sou-linda-check-') as folder:
        db = Database(Path(folder) / 'test.sqlite3')
        try:
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
    print('Sou Linda System: SQLite, CPP, descuentos, rentabilidad y respaldo verificados.')
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Sou Linda System · motor local de la notebook')
    parser.add_argument('--mobile', action='store_true', help='Habilitar reportes de solo lectura en la red local; requiere vincular el celular.')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--view', choices=('classic', 'agile'), default='classic',
                        help='Interfaz inicial: classic conserva la vista original; agile abre la alternativa Ágil.')
    parser.add_argument('--data-dir', type=Path, help='Carpeta de datos alternativa; permite pruebas aisladas.')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not 1024 <= args.port <= 65535:
        parser.error('El puerto debe estar entre 1024 y 65535.')
    frontend = Path(__file__).resolve().parents[1] / 'dist'
    if not (frontend / 'index.html').is_file():
        print('Falta la interfaz compilada en dist. Usá el paquete completo o ejecutá npm run build.', file=sys.stderr)
        return 1
    folder = (args.data_dir or data_directory()).expanduser().resolve()
    lock = None
    timer = None
    try:
        lock = InstanceLock(folder)
        path = folder / 'sou-linda.sqlite3'
        db = Database(path)
        try:
            automatic_backup(db, 'startup')
        finally:
            db.close()
        from sadi_local.web import create_app
        import uvicorn
        addresses = lan_addresses() if args.mobile else []
        app = create_app(path, static_dir=frontend, allow_mobile=args.mobile, allowed_hosts=addresses,
                         report_addresses=[f'http://{host}:{args.port}' for host in addresses])
        url = f'http://127.0.0.1:{args.port}' + ('/agil' if args.view == 'agile' else '')
        print(f'\nSou Linda System\nBase local: {path}\nAbrí el navegador en {url}\n')
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
                if (folder / 'sou-linda.sqlite3').is_file():
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
