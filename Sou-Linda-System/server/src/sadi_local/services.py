"""Transactional business operations for SADI Desktop.

Amounts are integer cents. Inventory value and physical units are authoritative;
CPP is their ratio and is frozen per sale line when stock actually leaves.
"""
from datetime import date
import hashlib
import json
import sqlite3
import unicodedata
from uuid import uuid4

from .constants import CHANNELS, PAYMENT_METHODS, MAX_CENTS
from .db import utc_now
from .money import allocate, integer, round_ratio


def uid():
    return str(uuid4())


def normalize(value):
    return ' '.join(''.join(c for c in unicodedata.normalize('NFKD', str(value)) if not unicodedata.combining(c)).casefold().split())


def validate_date(value=None):
    if value is None:
        return date.today().isoformat()
    if not isinstance(value, str):
        raise ValueError('La fecha debe tener formato AAAA-MM-DD.')
    try:
        result = date.fromisoformat(value)
    except ValueError:
        raise ValueError('La fecha no existe; usá AAAA-MM-DD.') from None
    if result.isoformat() != value:
        raise ValueError('Usá una fecha con formato AAAA-MM-DD.')
    return value


def text(value, label, required=True, maximum=160):
    if not isinstance(value, str):
        raise ValueError(f'{label}: ingresá un texto válido.')
    result = ' '.join(value.strip().split())
    if (required and not result) or len(result) > maximum:
        raise ValueError(f'{label}: ingresá entre {1 if required else 0} y {maximum} caracteres.')
    return result


def quantity(value, label='Cantidad', zero=False):
    return integer(value, label, 0 if zero else 1, 1_000_000_000)


def paid_method(value):
    if value not in PAYMENT_METHODS:
        raise ValueError('Elegí un medio de pago válido; fiado no es un cobro.')
    return value


def bool_value(value, label):
    if not isinstance(value, bool):
        raise ValueError(f'{label}: valor de confirmación inválido.')
    return value


class SadiService:
    def __init__(self, db):
        self.db = db
        self.c = db.connection

    def _row(self, table, identifier):
        # Table names are private static call sites, never user input.
        row = self.c.execute(f'SELECT * FROM "{table}" WHERE id=?', (identifier,)).fetchone()
        if row is None:
            raise ValueError('El registro ya no existe. Actualizá la pantalla e intentá otra vez.')
        return dict(row)

    def _execute(self, kind, data, command_id, work):
        identifier = command_id or uid()
        if not isinstance(identifier, str) or not identifier.strip() or len(identifier) > 160:
            raise ValueError('Identificador de operación inválido.')
        try:
            payload = json.dumps({'kind': kind, 'data': data}, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        except (TypeError, ValueError):
            raise ValueError('La operación contiene valores no válidos.') from None
        digest = hashlib.sha256(payload.encode('utf-8')).hexdigest()
        try:
            with self.db.transaction():
                old = self.c.execute('SELECT input_hash,result_json FROM commands WHERE id=?', (identifier,)).fetchone()
                if old:
                    if old['input_hash'] != digest:
                        raise ValueError('Este identificador ya se usó con otros datos. No se duplicó la operación.')
                    return json.loads(old['result_json'])
                result = work()
                self.c.execute('INSERT INTO commands(id,input_hash,result_json,created_at) VALUES(?,?,?,?)',
                               (identifier, digest, json.dumps(result, ensure_ascii=False, allow_nan=False), utc_now()))
                return result
        except sqlite3.IntegrityError as error:
            raise ValueError('Los datos duplican una clave o incumplen una relación. No se guardaron cambios.') from error

    def _sequence(self, table):
        return self.c.execute(f'SELECT COALESCE(MAX(sequence),0)+1 FROM "{table}"').fetchone()[0]

    def _economic(self, day, bucket, amount, order_id=None, channel=None, reference=''):
        integer(amount, 'Importe contable', -MAX_CENTS, MAX_CENTS)
        if amount:
            self.c.execute('INSERT INTO economic_entries VALUES(?,?,?,?,?,?,?)',
                           (uid(), day, bucket, amount, order_id, channel, reference))

    def _cash(self, day, method, delta, kind, order_id=None, reference='', note=''):
        paid_method(method)
        integer(delta, 'Movimiento de caja', -MAX_CENTS, MAX_CENTS)
        if delta:
            self.c.execute('INSERT INTO cash_entries VALUES(?,?,?,?,?,?,?,?,?)',
                           (uid(), self._sequence('cash_entries'), day, method, delta, kind, order_id, reference, note))

    def _move(self, variant_id, quantity_delta, reserved_delta, value_delta, kind, day, order_id=None, note=''):
        old = self.c.execute('SELECT * FROM inventory WHERE variant_id=?', (variant_id,)).fetchone()
        if old is None:
            raise ValueError('La variante no tiene inventario inicializado.')
        on_hand = quantity(old['on_hand'] + quantity_delta, 'Stock físico', zero=True)
        reserved = quantity(old['reserved'] + reserved_delta, 'Stock reservado', zero=True)
        value = integer(old['value_cents'] + value_delta, 'Valor de inventario')
        if reserved > on_hand:
            raise ValueError('Stock insuficiente: parte de estas unidades está reservada para otro pedido.')
        if not on_hand and value:
            raise ValueError('La salida debe consumir el valor residual del inventario.')
        self.c.execute('UPDATE inventory SET on_hand=?,reserved=?,value_cents=?,version=version+1 WHERE variant_id=?',
                       (on_hand, reserved, value, variant_id))
        self.c.execute('INSERT INTO inventory_movements VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (uid(), self._sequence('inventory_movements'), variant_id, order_id, quantity_delta,
                        reserved_delta, value_delta, kind, day, note, utc_now()))

    def list_variants(self):
        rows = self.c.execute('''SELECT v.*,p.name AS model,p.category,i.on_hand,i.reserved,
                i.on_hand-i.reserved AS available,i.value_cents FROM variants v
                JOIN products p ON p.id=v.product_id JOIN inventory i ON i.variant_id=v.id
                ORDER BY p.normalized_name,v.size,v.color''').fetchall()
        return [dict(row) | {'cpp_cents': round_ratio(row['value_cents'], row['on_hand']) if row['on_hand'] else 0} for row in rows]

    def save_variant(self, data):
        if not isinstance(data, dict):
            raise ValueError('Datos de variante inválidos.')
        def work():
            model = text(data.get('model', ''), 'Modelo')
            category = text(data.get('category', ''), 'Categoría', required=False)
            sku = text(data.get('sku', ''), 'SKU', maximum=80)
            size = text(data.get('size', ''), 'Talle', maximum=30)
            color = text(data.get('color', ''), 'Color', maximum=60)
            retail = integer(data.get('retail_cents'), 'Precio minorista')
            wholesale = integer(data.get('wholesale_cents'), 'Precio mayorista')
            minimum = quantity(data.get('min_stock', 0), 'Stock mínimo', zero=True)
            existing_id = data.get('id')
            if existing_id:
                old = self._row('variants', existing_id)
                product_id = old['product_id']
                product = self._row('products', product_id)
                if normalize(model) != product['normalized_name']:
                    raise ValueError('No se puede cambiar el modelo de una variante existente; creá otra variante.')
            else:
                product_id = data.get('product_id')
                if product_id:
                    product = self._row('products', product_id)
                    if normalize(model) != product['normalized_name']:
                        raise ValueError('El modelo no coincide con el producto seleccionado.')
                else:
                    product = self.c.execute('SELECT * FROM products WHERE normalized_name=?', (normalize(model),)).fetchone()
                    product_id = product['id'] if product else uid()
                    if product is None:
                        self.c.execute('INSERT INTO products VALUES(?,?,?,?)', (product_id, model, category, normalize(model)))
            for other in self.c.execute('SELECT id,sku,size,color,product_id FROM variants'):
                if other['id'] == existing_id:
                    continue
                if normalize(other['sku']) == normalize(sku):
                    raise ValueError('Ya existe una variante con ese SKU.')
                if other['product_id'] == product_id and normalize(other['size']) == normalize(size) and normalize(other['color']) == normalize(color):
                    raise ValueError('Ya existe la combinación de modelo, talle y color.')
            identifier = existing_id or uid()
            active = bool_value(data.get('active', True), 'Variante activa')
            if existing_id:
                if any(data.get(key, 0) for key in ('initial_qty', 'initial_unit_cost_cents')):
                    raise ValueError('Para cambiar stock o costo usá una entrada de mercadería, no editar variante.')
                self.c.execute('UPDATE variants SET sku=?,size=?,color=?,retail_cents=?,wholesale_cents=?,min_stock=?,active=? WHERE id=?',
                               (sku, size, color, retail, wholesale, minimum, int(active), identifier))
            else:
                self.c.execute('INSERT INTO variants VALUES(?,?,?,?,?,?,?,?,?)',
                               (identifier, product_id, sku, size, color, retail, wholesale, minimum, int(active)))
                self.c.execute('INSERT INTO inventory VALUES(?,0,0,0,0)', (identifier,))
                initial_qty = quantity(data.get('initial_qty', 0), 'Stock inicial', zero=True)
                initial_cost = integer(data.get('initial_unit_cost_cents', 0), 'Costo inicial')
                total_cost = integer(initial_qty * initial_cost, 'Valor inicial')
                if initial_qty:
                    self._move(identifier, initial_qty, 0, total_cost, 'opening', validate_date(), note='Carga inicial de inventario')
            return identifier
        return self._execute('save_variant', data, None, work)

    def receive_stock(self, variant_id, quantity, total_cost_cents, note='', business_date=None, command_id=None, paid=False, payment_method='Transferencia'):
        args = dict(variant_id=variant_id, quantity=quantity, total_cost_cents=total_cost_cents, note=note,
                    business_date=business_date, paid=paid, payment_method=payment_method)
        def work():
            self._row('variants', variant_id)
            qty = globals()['quantity'](quantity)
            cost = integer(total_cost_cents, 'Costo total de recepción')
            day = validate_date(business_date)
            memo = text(note, 'Nota', required=False, maximum=2000)
            paid_method(payment_method); bool_value(paid, 'Compra pagada')
            identifier = uid()
            self.c.execute('INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?)', (identifier, day, variant_id, qty, cost, memo, int(paid), payment_method))
            self._move(variant_id, qty, 0, cost, 'purchase', day, note=memo)
            if paid:
                self._cash(day, payment_method, -cost, 'purchase', reference=identifier, note=memo)
            return identifier
        return self._execute('receive_stock', args, command_id, work)

    def adjust_stock(self, variant_id, delta, note, total_cost_cents=0, business_date=None, command_id=None):
        args = dict(variant_id=variant_id, delta=delta, note=note, total_cost_cents=total_cost_cents, business_date=business_date)
        def work():
            self._row('variants', variant_id)
            integer(delta, 'Ajuste de unidades', -1_000_000_000, 1_000_000_000)
            integer(total_cost_cents, 'Valor incorporado')
            if not delta:
                raise ValueError('El ajuste debe cambiar al menos una unidad.')
            day = validate_date(business_date)
            memo = text(note, 'Motivo', maximum=2000)
            old = self.c.execute('SELECT * FROM inventory WHERE variant_id=?', (variant_id,)).fetchone()
            if delta > 0:
                value = integer(total_cost_cents, 'Valor incorporado')
            else:
                if -delta > old['on_hand'] - old['reserved']:
                    raise ValueError('El ajuste no puede consumir unidades reservadas.')
                value = -round_ratio(old['value_cents'] * -delta, old['on_hand'])
                self._economic(day, 'inventory_loss', -value, reference=variant_id)
            self._move(variant_id, delta, 0, value, 'adjustment', day, note=memo)
            return variant_id
        return self._execute('adjust_stock', args, command_id, work)

    def list_customers(self):
        return [dict(row) for row in self.c.execute('SELECT * FROM customers ORDER BY name COLLATE NOCASE')]

    def save_customer(self, name, phone='', social='', preferred_sizes='', customer_id=None):
        values = (text(name, 'Nombre'), text(phone, 'Teléfono', False, 80), text(social, 'Red social', False, 160),
                  text(preferred_sizes, 'Talles preferidos', False, 160))
        with self.db.transaction():
            if customer_id:
                self._row('customers', customer_id)
                self.c.execute('UPDATE customers SET name=?,phone=?,social=?,preferred_sizes=? WHERE id=?', (*values, customer_id))
            else:
                customer_id = uid()
                self.c.execute('INSERT INTO customers VALUES(?,?,?,?,?)', (customer_id, *values))
        return customer_id

    def create_order(self, items, channel, customer_id=None, discount_kind='fixed', discount_value=0, commission_bps=0,
                     shipping_cents=0, packaging_cents=0, payment_method='Efectivo', payment_terms='immediate',
                     business_date=None, status='completed', command_id=None, notes='', direct_cost_method='Efectivo', direct_costs_paid=True):
        args = {key: value for key, value in locals().copy().items() if key not in ('self', 'command_id')}
        def work():
            if channel not in CHANNELS:
                raise ValueError('Elegí un canal de venta válido.')
            if status not in ('pending', 'reserved', 'completed'):
                raise ValueError('Un pedido nuevo debe estar pendiente, reservado o completado.')
            if payment_terms not in ('immediate', 'credit') or payment_method not in (*PAYMENT_METHODS, 'Crédito'):
                raise ValueError('Elegí condiciones y medio de pago válidos.')
            terms = 'credit' if payment_method == 'Crédito' or payment_terms == 'credit' else 'immediate'
            if terms == 'credit' and not customer_id:
                raise ValueError('Las ventas a crédito requieren una clienta identificada.')
            if customer_id:
                self._row('customers', customer_id)
            day = validate_date(business_date)
            integer(commission_bps, 'Comisión', 0, 10000)
            integer(shipping_cents, 'Envío'); integer(packaging_cents, 'Packaging')
            paid_method(direct_cost_method); bool_value(direct_costs_paid, 'Costos directos pagados')
            memo = text(notes, 'Nota', False, 2000)
            if not isinstance(items, list) or not items:
                raise ValueError('Agregá al menos una variante al carrito.')
            prepared, seen = [], set()
            for line in items:
                if not isinstance(line, dict):
                    raise ValueError('Detalle de carrito inválido.')
                variant_id = line.get('variant_id')
                if variant_id in seen:
                    raise ValueError('La misma variante aparece dos veces en el carrito; unificá su cantidad.')
                seen.add(variant_id)
                variant = self._row('variants', variant_id)
                if not variant['active']:
                    raise ValueError('Una variante del carrito está desactivada.')
                product = self._row('products', variant['product_id'])
                qty = quantity(line.get('quantity'))
                price = integer(line.get('unit_price_cents'), 'Precio de venta')
                gross = integer(price * qty, 'Importe de línea')
                prepared.append((variant, product, qty, price, gross))
            subtotal = integer(sum(line[4] for line in prepared), 'Subtotal')
            if discount_kind == 'fixed':
                discount = integer(discount_value, 'Descuento fijo')
            elif discount_kind == 'percent':
                integer(discount_value, 'Porcentaje de descuento', 0, 10000)
                discount = round_ratio(subtotal * discount_value, 10000)
            else:
                raise ValueError('Elegí descuento fijo o porcentual.')
            if discount > subtotal:
                raise ValueError('El descuento no puede superar el subtotal.')
            portions = allocate(discount, [line[4] for line in prepared])
            identifier = uid()
            count = self.c.execute('SELECT COUNT(*) FROM orders').fetchone()[0] + 1
            number = f'S-{count:06d}'
            while self.c.execute('SELECT 1 FROM orders WHERE number=?', (number,)).fetchone():
                count += 1; number = f'S-{count:06d}'
            self.c.execute('''INSERT INTO orders(id,number,business_date,completed_date,channel,customer_id,status,terms,
                   payment_method,subtotal_cents,discount_kind,discount_value,discount_cents,total_cents,cogs_cents,
                   commission_bps,shipping_cents,packaging_cents,direct_cost_method,direct_costs_paid,source,external_key,
                   created_at,version,notes) VALUES(?,?,?,NULL,?,?,'pending',?,?,?,?,?,?,?,NULL,?,?,?,?,?,'pos',NULL,?,0,?)''',
                   (identifier, number, day, channel, customer_id, terms, payment_method, subtotal, discount_kind,
                    discount_value, discount, subtotal-discount, commission_bps, shipping_cents, packaging_cents,
                    direct_cost_method, int(direct_costs_paid), utc_now(), memo))
            for (variant, product, qty, price, gross), portion in zip(prepared, portions):
                self.c.execute('INSERT INTO order_items VALUES(?,?,?,?,?,?,?,?,?,?,NULL)',
                    (uid(), identifier, variant['id'], product['name'], f"Talle {variant['size']} · {variant['color']}", qty, price, gross, portion, gross-portion))
            if status == 'reserved':
                self._reserve(identifier, day)
            elif status == 'completed':
                self._complete(identifier, day)
            return identifier
        return self._execute('create_order', args, command_id, work)

    def _reserve(self, order_id, day):
        order = self._row('orders', order_id)
        if order['status'] == 'reserved':
            return order_id
        if order['status'] != 'pending':
            raise ValueError('Solo se puede reservar un pedido pendiente.')
        if day < order['business_date']:
            raise ValueError('La reserva no puede ser anterior al pedido.')
        for line in self.c.execute('SELECT * FROM order_items WHERE order_id=?', (order_id,)).fetchall():
            self._move(line['variant_id'], 0, line['quantity'], 0, 'reserve', day, order_id)
            self.c.execute('INSERT INTO reservations VALUES(?,?,?,?,?,\'active\',NULL)', (uid(), order_id, line['id'], line['variant_id'], line['quantity']))
        self.c.execute("UPDATE orders SET status='reserved',version=version+1 WHERE id=?", (order_id,))
        return order_id

    def reserve_order(self, order_id, command_id=None, business_date=None):
        return self._execute('reserve_order', {'order_id': order_id, 'business_date': business_date}, command_id,
                             lambda: self._reserve(order_id, validate_date(business_date)))

    def _release(self, order_id, day, next_state='pending'):
        order = self._row('orders', order_id)
        if order['status'] not in ('pending', 'reserved'):
            raise ValueError('Este pedido ya no tiene una reserva liberable.')
        if day < order['business_date']:
            raise ValueError('La liberación no puede ser anterior al pedido.')
        for reservation in self.c.execute("SELECT * FROM reservations WHERE order_id=? AND state='active'", (order_id,)).fetchall():
            self._move(reservation['variant_id'], 0, -reservation['quantity'], 0, 'release', day, order_id)
            self.c.execute("UPDATE reservations SET state='released' WHERE id=?", (reservation['id'],))
        self.c.execute('UPDATE orders SET status=?,cancelled_date=?,version=version+1 WHERE id=?',
                       (next_state, day if next_state == 'cancelled' else None, order_id))
        return order_id

    def release_reservation(self, order_id, command_id=None, business_date=None):
        return self._execute('release_reservation', {'order_id': order_id, 'business_date': business_date}, command_id,
                             lambda: self._release(order_id, validate_date(business_date)))

    def _complete(self, order_id, day):
        order = self._row('orders', order_id)
        if order['status'] == 'completed':
            return order_id
        if order['status'] not in ('pending', 'reserved'):
            raise ValueError('No se puede completar un pedido cancelado.')
        if day < order['business_date']:
            raise ValueError('La venta no puede ser anterior a la fecha del pedido.')
        cogs_total = 0
        for line in self.c.execute('SELECT * FROM order_items WHERE order_id=?', (order_id,)).fetchall():
            inventory = self.c.execute('SELECT * FROM inventory WHERE variant_id=?', (line['variant_id'],)).fetchone()
            own = self.c.execute("SELECT COALESCE(SUM(quantity),0) FROM reservations WHERE order_item_id=? AND state='active'", (line['id'],)).fetchone()[0]
            if inventory['on_hand'] - inventory['reserved'] + own < line['quantity']:
                raise ValueError(f"Stock insuficiente para {line['model_snapshot']} ({line['variant_snapshot']}).")
            cost = round_ratio(inventory['value_cents'] * line['quantity'], inventory['on_hand'])
            cogs_total = integer(cogs_total + cost, 'CMV total')
            self._move(line['variant_id'], -line['quantity'], -own, -cost, 'sale', day, order_id)
            self.c.execute("UPDATE reservations SET state='consumed' WHERE order_item_id=? AND state='active'", (line['id'],))
            self.c.execute('UPDATE order_items SET cogs_cents=? WHERE id=?', (cost, line['id']))
        self.c.execute("UPDATE orders SET status='completed',completed_date=?,cogs_cents=?,version=version+1 WHERE id=?", (day, cogs_total, order_id))
        self._economic(day, 'revenue', order['total_cents'], order_id, order['channel'], order_id)
        self._economic(day, 'cogs', cogs_total, order_id, order['channel'], order_id)
        for bucket, amount in (('shipping', order['shipping_cents']), ('packaging', order['packaging_cents'])):
            self._economic(day, bucket, amount, order_id, order['channel'], order_id)
            if order['direct_costs_paid']:
                self._cash(day, order['direct_cost_method'], -amount, bucket, order_id, order_id)
        if order['terms'] == 'immediate':
            balance = self._balance(order_id)
            if balance > 0:
                self._payment(order_id, balance, order['payment_method'], order['commission_bps'], day)
        return order_id

    def complete_order(self, order_id, command_id=None, business_date=None):
        return self._execute('complete_order', {'order_id': order_id, 'business_date': business_date}, command_id,
                             lambda: self._complete(order_id, validate_date(business_date)))

    def _balance(self, order_id):
        order = self._row('orders', order_id)
        charge = order['total_cents']
        if order['status'] == 'cancelled' and order['completed_date'] is None:
            charge = 0
        credit = self.c.execute('SELECT COALESCE(SUM(revenue_cents),0) FROM returns WHERE order_id=?', (order_id,)).fetchone()[0]
        paid = self.c.execute("SELECT COALESCE(SUM(CASE kind WHEN 'receipt' THEN amount_cents ELSE -amount_cents END),0) FROM payments WHERE order_id=?", (order_id,)).fetchone()[0]
        return charge - credit - paid

    def _payment(self, order_id, amount_cents, method, commission_bps, day):
        order = self._row('orders', order_id)
        integer(amount_cents, 'Cobro', 1)
        paid_method(method)
        integer(commission_bps, 'Comisión', 0, 10000)
        if order['status'] == 'cancelled':
            raise ValueError('Un pedido cancelado no puede recibir nuevos cobros.')
        if day < order['business_date']:
            raise ValueError('El cobro no puede ser anterior al pedido.')
        if amount_cents > self._balance(order_id):
            raise ValueError('El cobro supera el saldo pendiente del pedido.')
        fee = round_ratio(amount_cents * commission_bps, 10000)
        identifier = uid()
        self.c.execute('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?)',
                       (identifier, order_id, day, amount_cents, method, 'receipt', commission_bps, fee, utc_now()))
        self._cash(day, method, amount_cents, 'receipt', order_id, identifier)
        self._economic(day, 'commission', fee, order_id, order['channel'], identifier)
        self._cash(day, method, -fee, 'commission', order_id, identifier)
        return identifier

    def record_payment(self, order_id, amount_cents, method, commission_bps=None, business_date=None, command_id=None):
        args = dict(order_id=order_id, amount_cents=amount_cents, method=method, commission_bps=commission_bps, business_date=business_date)
        def work():
            order = self._row('orders', order_id)
            rate = order['commission_bps'] if commission_bps is None else commission_bps
            return self._payment(order_id, amount_cents, method, rate, validate_date(business_date))
        return self._execute('record_payment', args, command_id, work)

    def record_refund(self, order_id, amount_cents, method, business_date=None, command_id=None):
        args = dict(order_id=order_id, amount_cents=amount_cents, method=method, business_date=business_date)
        def work():
            order = self._row('orders', order_id)
            integer(amount_cents, 'Reembolso', 1); paid_method(method)
            day = validate_date(business_date)
            if day < order['business_date']:
                raise ValueError('El reintegro no puede ser anterior al pedido.')
            if amount_cents > -self._balance(order_id):
                raise ValueError('El reintegro supera el crédito a favor de la clienta.')
            charge_at_date = order['total_cents']
            if order['cancelled_date'] and order['completed_date'] is None and order['cancelled_date'] <= day:
                charge_at_date = 0
            returned_at_date = self.c.execute('SELECT COALESCE(SUM(revenue_cents),0) FROM returns WHERE order_id=? AND business_date<=?', (order_id, day)).fetchone()[0]
            paid_at_date = self.c.execute("SELECT COALESCE(SUM(CASE kind WHEN 'receipt' THEN amount_cents ELSE -amount_cents END),0) FROM payments WHERE order_id=? AND business_date<=?", (order_id, day)).fetchone()[0]
            if amount_cents > paid_at_date + returned_at_date - charge_at_date:
                raise ValueError('En esa fecha todavía no existía crédito suficiente para reembolsar.')
            identifier = uid()
            self.c.execute('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?,?)',
                           (identifier, order_id, day, amount_cents, method, 'refund', 0, 0, utc_now()))
            self._cash(day, method, -amount_cents, 'refund', order_id, identifier)
            return identifier
        return self._execute('record_refund', args, command_id, work)

    def _return(self, order_id, selection, day):
        order = self._row('orders', order_id)
        if order['completed_date'] is None:
            raise ValueError('Solo se devuelve mercadería de una venta completada.')
        if day < order['completed_date']:
            raise ValueError('La devolución no puede ser anterior a la venta.')
        lines = self.c.execute('SELECT * FROM order_items WHERE order_id=?', (order_id,)).fetchall()
        known = {line['id'] for line in lines}
        if selection is not None and (not isinstance(selection, dict) or not selection or set(selection) - known):
            raise ValueError('Seleccioná cantidades válidas de las líneas de esta venta.')
        prepared, revenue_total, cogs_total = [], 0, 0
        for line in lines:
            old = self.c.execute('SELECT COALESCE(SUM(quantity),0) qty,COALESCE(SUM(revenue_cents),0) revenue,COALESCE(SUM(cogs_cents),0) cogs FROM return_items WHERE order_item_id=?', (line['id'],)).fetchone()
            remaining = line['quantity'] - old['qty']
            qty = remaining if selection is None else selection.get(line['id'], 0)
            quantity(qty, zero=True)
            if qty > remaining:
                raise ValueError('No podés devolver más unidades de las que quedan sin devolver.')
            if not qty:
                continue
            if line['cogs_cents'] is None:
                raise ValueError('Primero resolvé el costo histórico de la venta importada; no se ingresará inventario con costo ficticio.')
            cumulative = old['qty'] + qty
            revenue = round_ratio(line['net_cents'] * cumulative, line['quantity']) - old['revenue']
            cost = round_ratio(line['cogs_cents'] * cumulative, line['quantity']) - old['cogs']
            prepared.append((line, qty, revenue, cost))
            revenue_total += revenue; cogs_total += cost
        if not prepared:
            raise ValueError('No quedan unidades para devolver.')
        identifier = uid()
        self.c.execute('INSERT INTO returns VALUES(?,?,?,?,?,?)', (identifier, order_id, day, revenue_total, cogs_total, utc_now()))
        for line, qty, revenue, cost in prepared:
            self.c.execute('INSERT INTO return_items VALUES(?,?,?,?,?,?)', (uid(), identifier, line['id'], qty, revenue, cost))
            self._move(line['variant_id'], qty, 0, cost, 'return', day, order_id)
        self._economic(day, 'revenue', -revenue_total, order_id, order['channel'], identifier)
        self._economic(day, 'cogs', -cogs_total, order_id, order['channel'], identifier)
        original_quantity = sum(line['quantity'] for line in lines)
        returned_quantity = self.c.execute('SELECT COALESCE(SUM(ri.quantity),0) FROM return_items ri JOIN order_items oi ON oi.id=ri.order_item_id WHERE oi.order_id=?', (order_id,)).fetchone()[0]
        if returned_quantity == original_quantity:
            self.c.execute("UPDATE orders SET status='cancelled',cancelled_date=?,version=version+1 WHERE id=?", (day, order_id))
        else:
            self.c.execute('UPDATE orders SET version=version+1 WHERE id=?', (order_id,))
        return identifier

    def return_order(self, order_id, items=None, business_date=None, command_id=None):
        args = dict(order_id=order_id, items=items, business_date=business_date)
        return self._execute('return_order', args, command_id, lambda: self._return(order_id, items, validate_date(business_date)))

    def cancel_order(self, order_id, confirm_return=False, command_id=None, business_date=None):
        args = dict(order_id=order_id, confirm_return=confirm_return, business_date=business_date)
        def work():
            bool_value(confirm_return, 'Devolución confirmada')
            order = self._row('orders', order_id)
            day = validate_date(business_date)
            if day < order['business_date']:
                raise ValueError('La cancelación no puede ser anterior al pedido.')
            if order['status'] == 'cancelled':
                return order_id
            if order['completed_date'] is not None:
                if not confirm_return:
                    raise ValueError('Confirmá primero que recibiste la devolución física de toda la mercadería.')
                self._return(order_id, None, day)
            else:
                self._release(order_id, day, 'cancelled')
            return order_id
        return self._execute('cancel_order', args, command_id, work)

    def save_expense(self, business_date, category, description, amount_cents, payment_method, channel=None,
                     cost_type='variable', paid=True, command_id=None):
        args = {key: value for key, value in locals().copy().items() if key not in ('self', 'command_id')}
        def work():
            day = validate_date(business_date)
            category_text = text(category, 'Categoría')
            desc = text(description, 'Descripción', maximum=2000)
            integer(amount_cents, 'Importe del gasto', 1); paid_method(payment_method); bool_value(paid, 'Gasto pagado')
            if channel is not None and channel not in CHANNELS:
                raise ValueError('Canal del gasto inválido.')
            if cost_type not in ('fixed', 'variable'):
                raise ValueError('Elegí gasto fijo o variable.')
            identifier = uid()
            self.c.execute('INSERT INTO expenses VALUES(?,?,?,?,?,?,?,?,?)', (identifier, day, category_text, cost_type, desc, amount_cents, payment_method, channel, int(paid)))
            self._economic(day, 'operating_expense', amount_cents, channel=channel, reference=identifier)
            if paid:
                self._cash(day, payment_method, -amount_cents, 'expense', reference=identifier, note=desc)
            return identifier
        return self._execute('save_expense', args, command_id, work)

    def get_order(self, order_id):
        order = self._row('orders', order_id)
        customer = self.c.execute('SELECT name FROM customers WHERE id=?', (order['customer_id'],)).fetchone() if order['customer_id'] else None
        order['customer_name'] = customer['name'] if customer else 'Venta mostrador'
        lines = []
        for line in self.c.execute('SELECT * FROM order_items WHERE order_id=? ORDER BY rowid', (order_id,)):
            returned = self.c.execute('SELECT COALESCE(SUM(quantity),0) qty,COALESCE(SUM(revenue_cents),0) revenue,COALESCE(SUM(cogs_cents),0) cogs FROM return_items WHERE order_item_id=?', (line['id'],)).fetchone()
            lines.append(dict(line) | {'returned_quantity': returned['qty'], 'returned_revenue_cents': returned['revenue'], 'returned_cogs_cents': returned['cogs']})
        order['items'] = lines
        order['payments'] = [dict(row) for row in self.c.execute('SELECT * FROM payments WHERE order_id=? ORDER BY business_date,created_at', (order_id,))]
        order['returns'] = [dict(row) for row in self.c.execute('SELECT * FROM returns WHERE order_id=? ORDER BY business_date,created_at', (order_id,))]
        order['receipts_cents'] = sum(p['amount_cents'] for p in order['payments'] if p['kind'] == 'receipt')
        order['refund_cents'] = sum(p['amount_cents'] for p in order['payments'] if p['kind'] == 'refund')
        order['paid_cents'] = order['receipts_cents'] - order['refund_cents']
        order['balance_cents'] = self._balance(order_id)
        order['commission_cents'] = sum(p['commission_cents'] for p in order['payments'])
        order['costs'] = [dict(row) for row in self.c.execute("SELECT * FROM economic_entries WHERE order_id=? AND bucket NOT IN ('revenue','cogs')", (order_id,))]
        entries = self.c.execute('SELECT bucket,amount_cents FROM economic_entries WHERE order_id=?', (order_id,)).fetchall()
        order['net_profit_cents'] = None if order['completed_date'] and order['cogs_cents'] is None else sum(e['amount_cents'] if e['bucket'] == 'revenue' else -e['amount_cents'] for e in entries)
        return order

    def pay_expense(self, expense_id, payment_method, business_date=None, command_id=None):
        """Settle an accrued expense without recognizing the expense twice."""
        args = dict(expense_id=expense_id, payment_method=payment_method, business_date=business_date)
        def work():
            expense = self._row('expenses', expense_id)
            day = validate_date(business_date)
            paid_method(payment_method)
            if day < expense['business_date']:
                raise ValueError('El pago no puede ser anterior al gasto registrado.')
            if not expense['paid']:
                self._cash(day, payment_method, -expense['amount_cents'], 'expense', reference=expense_id, note=expense['description'])
                self.c.execute('UPDATE expenses SET paid=1,payment_method=? WHERE id=?', (payment_method, expense_id))
            return expense_id
        return self._execute('pay_expense', args, command_id, work)

    def pay_direct_costs(self, order_id, payment_method, business_date=None, command_id=None):
        """Settle shipping/packaging only; fees belong to their original receipts."""
        args = dict(order_id=order_id, payment_method=payment_method, business_date=business_date)
        def work():
            order = self._row('orders', order_id)
            day = validate_date(business_date)
            paid_method(payment_method)
            if order['completed_date'] is None:
                raise ValueError('Primero completá el pedido para registrar estos costos.')
            if day < order['completed_date']:
                raise ValueError('El pago no puede ser anterior a los costos reconocidos.')
            if not order['direct_costs_paid']:
                for bucket, amount in (('shipping', order['shipping_cents']), ('packaging', order['packaging_cents'])):
                    self._cash(day, payment_method, -amount, bucket, order_id, order_id)
                self.c.execute('UPDATE orders SET direct_costs_paid=1,direct_cost_method=?,version=version+1 WHERE id=?', (payment_method, order_id))
            return order_id
        return self._execute('pay_direct_costs', args, command_id, work)

    def pay_purchase(self, purchase_id, payment_method, business_date=None, command_id=None):
        """Settle a stock receipt without changing its CPP value or recognizing an expense.

        BEGIN IMMEDIATE serializes attempts from separate connections. The document's
        paid flag also protects a second command ID, while the command log replays a
        retry with the same ID. A later payment never changes the receipt's date/value.
        """
        args = dict(purchase_id=purchase_id, payment_method=payment_method, business_date=business_date)
        def work():
            purchase = self._row('purchases', purchase_id)
            day = validate_date(business_date)
            paid_method(payment_method)
            if day < purchase['business_date']:
                raise ValueError('El pago no puede ser anterior a la recepción de mercadería.')
            if not purchase['paid']:
                self._cash(day, payment_method, -purchase['total_cost_cents'], 'purchase',
                           reference=purchase_id, note=purchase['note'])
                self.c.execute('UPDATE purchases SET paid=1,method=? WHERE id=?',
                               (payment_method, purchase_id))
            return purchase_id
        return self._execute('pay_purchase', args, command_id, work)

    def list_orders(self):
        return [self.get_order(row['id']) for row in self.c.execute('SELECT id FROM orders ORDER BY business_date DESC,created_at DESC')]
