import type { Sale, Snapshot, Variant } from '../domain/types';

/** Counts only. Financial totals always come from the Python report engine. */
function unitCount(values: number[]): number | null {
  let total = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    total += BigInt(value);
  }
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

export function stockOverview(variants: Variant[]) {
  const active = variants.filter(variant => variant.active);
  return {
    variantCount: active.length,
    availableUnits: unitCount(active.map(variant => variant.available)),
    reservedUnits: unitCount(active.map(variant => variant.reserved)),
    soldOutCount: active.filter(variant => variant.available === 0).length,
  };
}

export function stockAlerts(data: Pick<Snapshot, 'products' | 'variants'>) {
  const names = new Map(data.products.map(product => [product.id, product.name]));
  return data.variants
    .filter(variant => variant.active && variant.available <= variant.minStock)
    .map(variant => ({ variant, productName: names.get(variant.productId) ?? 'Producto sin nombre' }))
    .sort((a, b) => a.variant.available - b.variant.available || a.productName.localeCompare(b.productName, 'es') || a.variant.size.localeCompare(b.variant.size, 'es', { numeric: true }) || a.variant.color.localeCompare(b.variant.color, 'es'));
}

export function openOrderCounts(sales: Sale[]) {
  return {
    pending: sales.filter(sale => sale.status === 'pending').length,
    reserved: sales.filter(sale => sale.status === 'reserved').length,
  };
}

export function orderStatusLabel(sale: Sale): string {
  if (sale.status === 'pending') return 'Pendiente';
  if (sale.status === 'reserved') return 'Reservado';
  if (sale.status === 'void') return sale.balance < 0 ? 'Cancelado · saldo a favor' : 'Cancelado';
  if (sale.balance > 0) return 'Completado · por cobrar';
  if (sale.balance < 0) return 'Completado · saldo a favor';
  if (sale.items.some(item => item.returnedQuantity > 0)) return 'Completado · con devolución';
  return 'Completado · pagado';
}

export function recentOrderActivity(sales: Sale[], limit = 5) {
  return sales.map(sale => ({ sale, date: [sale.date, sale.completedDate ?? '', sale.cancelledDate ?? ''].sort().at(-1)! }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.sale.number.localeCompare(a.sale.number, 'es', { numeric: true }))
    .slice(0, Math.max(0, limit));
}
