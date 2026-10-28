"""Explicit JSON contracts between the SQLite domain and the React client.

These mappings never mutate catalog, financial or inventory records. Monetary
amounts remain integer cents; line-level cost totals remain authoritative when
an indicative unit cost needs rounding for display.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .currency import round_money_ratio


def normalize_sale(service, order_id_or_dict: str | Mapping[str, Any]) -> dict[str, Any]:
    """Return the complete camelCase Sale projection expected by the frontend."""
    order = (service.get_order(order_id_or_dict) if isinstance(order_id_or_dict, str)
             else dict(order_id_or_dict))
    # A bare SQLite row has no nested financial projections. Hydrate through the
    # domain rather than guessing debt, partial returns or payment amounts.
    if 'items' not in order or 'balance_cents' not in order:
        order = service.get_order(order['id'])
    items = []
    for line in order['items']:
        total_cost = line['cogs_cents']
        unit_cost = (round_money_ratio(service.db, total_cost, line['quantity'])
                     if total_cost is not None else None)
        items.append({
            'id': line['id'],
            'variantId': line['variant_id'],
            'productName': line['model_snapshot'],
            'variantLabel': line['variant_snapshot'],
            'quantity': line['quantity'],
            'unitPrice': line['unit_price_cents'],
            'unitCost': unit_cost,
            'costTotal': total_cost,
            'total': line['gross_cents'],
            'netTotal': line['net_cents'],
            'discount': line['discount_cents'],
            'returnedQuantity': line.get('returned_quantity', 0),
        })
    result = {
        'id': order['id'],
        'number': order['number'],
        'date': order['business_date'],
        'customerName': order.get('customer_name', 'Venta mostrador'),
        'channel': order['channel'],
        'paymentMethod': 'Crédito' if order.get('terms') == 'credit' else order['payment_method'],
        'items': items,
        'shippingCost': order['shipping_cents'],
        'packagingCost': order['packaging_cents'],
        'discount': order['discount_cents'],
        'discountKind': order['discount_kind'],
        'discountValue': order['discount_value'],
        'commissionRate': order['commission_bps'],
        'commissionCost': order.get('commission_cents', sum(p['commission_cents'] for p in order.get('payments', []))),
        'directCostMethod': order['direct_cost_method'],
        'directCostsPaid': bool(order['direct_costs_paid']),
        'total': order['total_cents'],
        'costTotal': order['cogs_cents'],
        'balance': order['balance_cents'],
        'paid': order.get('paid_cents', 0),
        'refunded': order.get('refund_cents', 0),
        'returnedRevenue': sum(row['revenue_cents'] for row in order.get('returns', [])),
        'status': 'void' if order['status'] == 'cancelled' else order['status'],
        'source': order['source'],
    }
    for source_key, target_key in (
        ('completed_date', 'completedDate'), ('cancelled_date', 'cancelledDate'),
        ('customer_id', 'customerId'), ('external_key', 'sourceKey'),
    ):
        if order.get(source_key) is not None:
            result[target_key] = order[source_key]
    return result


def normalize_purchase(row: Mapping[str, Any], variants_by_id: Mapping[str, Mapping[str, Any]] | None = None) -> dict[str, Any]:
    """Map a receipt and, optionally, its current descriptive catalog fields."""
    purchase = dict(row)
    result = {
        'id': purchase['id'],
        'date': purchase['business_date'],
        'variantId': purchase['variant_id'],
        'quantity': purchase['quantity'],
        'totalCost': purchase['total_cost_cents'],
        'note': purchase['note'],
        'paid': bool(purchase['paid']),
        'paymentMethod': purchase['method'],
    }
    variant = variants_by_id.get(purchase['variant_id']) if variants_by_id is not None else None
    if variant is not None:
        for key in ('model', 'sku', 'size', 'color'):
            if key in variant:
                result[key] = variant[key]
    return result


def normalize_snapshot(db, service) -> dict[str, Any]:
    """Read all projections in one SQLite transaction, without mixed revisions."""
    with db.transaction():
        raw = db.snapshot()
        variant_rows = service.list_variants()
        sales = [normalize_sale(service, order) for order in service.list_orders()]
        products = [{
            'id': row['id'], 'name': row['name'], 'category': row['category'], 'createdAt': '',
        } for row in raw['products']]
        variants = [{
            'id': row['id'],
            'productId': row['product_id'],
            'sku': row['sku'],
            'size': row['size'],
            'color': row['color'],
            'cost': row['cpp_cents'],
            'retailPrice': row['retail_cents'],
            'wholesalePrice': row['wholesale_cents'],
            'stock': row['on_hand'],
            'reserved': row['reserved'],
            'available': row['available'],
            'inventoryValue': row['value_cents'],
            'minStock': row['min_stock'],
            'active': bool(row['active']),
        } for row in variant_rows]
        customers = [{
            'id': row['id'], 'name': row['name'], 'phone': row['phone'], 'social': row['social'],
            'preferredSize': row['preferred_sizes'], 'createdAt': '',
        } for row in raw['customers']]
        expenses = []
        for row in raw['expenses']:
            expense = {
                'id': row['id'], 'date': row['business_date'], 'category': row['category'],
                'description': row['description'], 'amount': row['amount_cents'],
                'paymentMethod': row['payment_method'], 'paid': bool(row['paid']), 'costType': row['cost_type'],
            }
            if row['channel'] is not None:
                expense['channel'] = row['channel']
            expenses.append(expense)
        movements = []
        for row in raw['inventory_movements']:
            # A reservation is not a physical entry/exit. Those events remain in
            # SQLite for audit but are not disguised as StockMovement sales.
            if not row['quantity_delta']:
                continue
            movement = {
                'id': row['id'], 'variantId': row['variant_id'], 'date': row['business_date'],
                'quantity': row['quantity_delta'], 'type': row['kind'], 'note': row['note'],
            }
            if row['order_id'] is not None:
                movement['reference'] = row['order_id']
            movements.append(movement)
        payments = [{
            'id': row['id'], 'saleId': row['order_id'], 'date': row['business_date'],
            'amount': row['amount_cents'], 'method': row['method'], 'kind': row['kind'],
            'commission': row['commission_cents'],
        } for row in raw['payments']]
        cash_closings = [{
            'id': row['id'], 'date': row['business_date'], 'openingCash': row['opening_cents'],
            'expectedCash': row['expected_cents'], 'countedCash': row['counted_cents'],
            'difference': row['difference_cents'], 'note': row['note'],
        } for row in raw['cash_closings']]
        return {
            'products': products, 'variants': variants, 'customers': customers, 'sales': sales,
            'expenses': expenses, 'movements': movements, 'payments': payments,
            'cashClosings': cash_closings,
            'settings': [{'key': row['key'], 'value': row['value']} for row in raw['meta']],
        }
