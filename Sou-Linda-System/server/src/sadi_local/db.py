"""SQLite ownership, initialization and durable transaction boundaries."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

TABLES = ('products', 'variants', 'inventory', 'customers', 'orders', 'order_items', 'reservations',
          'inventory_movements', 'payments', 'returns', 'return_items', 'expenses', 'economic_entries',
          'cash_entries', 'cash_closings', 'purchases', 'drafts', 'meta', 'commands')
SCHEMA_VERSION = 1


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


class Database:
    def __init__(self, path):
        self.path = Path(path) if str(path) != ':memory:' else ':memory:'
        if self.path != ':memory:':
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(self.path), isolation_level=None, timeout=5)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute('PRAGMA foreign_keys=ON')
        self.connection.execute('PRAGMA busy_timeout=5000')
        self.connection.execute('PRAGMA journal_mode=WAL')
        self.connection.execute('PRAGMA synchronous=FULL')
        self._depth = 0
        try:
            version = self.connection.execute('PRAGMA user_version').fetchone()[0]
            if version > SCHEMA_VERSION:
                raise ValueError('Esta base pertenece a una versión más reciente de SADI. No se modificó.')
            if version == 0:
                existing = self.connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
                if existing:
                    raise ValueError('El archivo no es una base nueva ni una base SADI compatible.')
                schema = Path(__file__).with_name('schema.sql').read_text(encoding='utf-8')
                self.connection.executescript('BEGIN IMMEDIATE;\n' + schema + '\nCOMMIT;')
        except Exception:
            self.connection.close()
            raise

    @contextmanager
    def transaction(self):
        depth = self._depth
        savepoint = f'sadi_nested_{depth}'
        if depth:
            self.connection.execute(f'SAVEPOINT {savepoint}')
        else:
            self.connection.execute('BEGIN IMMEDIATE')
        self._depth += 1
        try:
            yield self.connection
            if depth:
                self.connection.execute(f'RELEASE SAVEPOINT {savepoint}')
            else:
                self.connection.execute('COMMIT')
        except BaseException:
            if depth and self.connection.in_transaction:
                self.connection.execute(f'ROLLBACK TO SAVEPOINT {savepoint}')
                self.connection.execute(f'RELEASE SAVEPOINT {savepoint}')
            elif self.connection.in_transaction:
                self.connection.execute('ROLLBACK')
            raise
        finally:
            self._depth -= 1

    def snapshot(self):
        with self.transaction():
            return {name: [dict(row) for row in self.connection.execute(f'SELECT * FROM "{name}"')] for name in TABLES}

    def get_meta(self, key, default=None):
        row = self.connection.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
        return row['value'] if row else default

    def set_meta(self, key, value):
        with self.transaction():
            self.connection.execute('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, str(value)))

    def save_draft(self, key, data):
        payload = json.dumps(data, ensure_ascii=False, allow_nan=False)
        with self.transaction():
            self.connection.execute('INSERT INTO drafts(key,payload,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at', (key, payload, utc_now()))

    def load_draft(self, key):
        row = self.connection.execute('SELECT payload FROM drafts WHERE key=?', (key,)).fetchone()
        return json.loads(row['payload']) if row else None

    def delete_draft(self, key):
        with self.transaction():
            self.connection.execute('DELETE FROM drafts WHERE key=?', (key,))

    def close(self):
        self.connection.close()
