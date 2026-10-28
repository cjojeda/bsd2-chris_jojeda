import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT, type Sale, type Snapshot, type Variant } from '../src/domain/types';
import { openOrderCounts, orderStatusLabel, recentOrderActivity, stockAlerts, stockOverview } from '../src/alternative/selectors';

const variant = (extra: Partial<Variant> = {}): Variant => ({ id: 'v1', productId: 'p1', sku: 'VAL-95-ROJ', size: '95', color: 'Rojo', cost: 100, retailPrice: 200, wholesalePrice: 150, stock: 10, reserved: 0, available: 10, inventoryValue: 1000, minStock: 2, active: true, ...extra });
const sale = (extra: Partial<Sale> = {}): Sale => ({ id: 's1', number: 'SL-0001', date: '2026-09-30', completedDate: '2026-09-30', channel: 'Instagram', paymentMethod: 'Efectivo', items: [], shippingCost: 0, packagingCost: 0, discount: 0, discountKind: 'fixed', discountValue: 0, commissionRate: 0, commissionCost: 0, directCostMethod: 'Efectivo', directCostsPaid: true, total: 10000, costTotal: 4000, balance: 0, paid: 10000, refunded: 0, returnedRevenue: 0, status: 'completed', source: 'pos', ...extra });

describe('resumen diario de la vista Ágil', () => {
  it('alerta por disponible aunque el stock físico alcance y excluye variantes inactivas', () => {
    const data: Snapshot = { ...EMPTY_SNAPSHOT, products: [{ id: 'p1', name: 'Valentina', category: 'Conjuntos', createdAt: '2026-01-01' }], variants: [variant({ reserved: 9, available: 1 }), variant({ id: 'v2', available: 0, stock: 0, active: false }), variant({ id: 'v3', stock: 0, available: 0, size: '100' })] };
    const alerts = stockAlerts(data);
    expect(alerts.map(row => row.variant.id)).toEqual(['v3', 'v1']);
    expect(alerts[1].productName).toBe('Valentina');
    expect(stockOverview(data.variants)).toEqual({ variantCount: 2, availableUnits: 1, reservedUnits: 9, soldOutCount: 1 });
  });

  it('conserva los saldos firmados y la devolución de una venta cancelada', () => {
    const returned = sale({ status: 'void', cancelledDate: '2026-10-28', returnedRevenue: 10000, refunded: 2500, balance: -7500 });
    expect(orderStatusLabel(returned)).toBe('Cancelado · saldo a favor');
    expect(orderStatusLabel(sale({ balance: 5000 }))).toBe('Completado · por cobrar');
    expect(returned.balance).toBe(-7500);
    expect(returned.total).toBe(10000);
  });

  it('ordena por la última actividad del pedido y no altera el historial original', () => {
    const original = [sale({ id: 'new', number: 'SL-0002', date: '2026-10-01', completedDate: '2026-10-01' }), sale({ id: 'returned', cancelledDate: '2026-10-28', status: 'void' })];
    expect(recentOrderActivity(original).map(row => [row.sale.id, row.date])).toEqual([['returned', '2026-10-28'], ['new', '2026-10-01']]);
    expect(original.map(row => row.id)).toEqual(['new', 'returned']);
    expect(recentOrderActivity(original, 0)).toEqual([]);
  });

  it('separa pedidos pendientes y reservas de las ventas ya entregadas o canceladas', () => {
    expect(openOrderCounts([sale({ status: 'pending' }), sale({ status: 'reserved' }), sale({ status: 'completed', balance: 300 }), sale({ status: 'void', balance: -300 })])).toEqual({ pending: 1, reserved: 1 });
  });

  it('evita mostrar un conteo de prendas aproximado por desborde', () => {
    expect(stockOverview([variant({ available: Number.MAX_SAFE_INTEGER }), variant({ id: 'v2', available: 1 })]).availableUnits).toBeNull();
  });
});
