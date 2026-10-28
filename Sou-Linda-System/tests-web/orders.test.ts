import { describe, expect, it } from 'vitest';
import { EMPTY_SNAPSHOT, type Sale, type Snapshot } from '../src/domain/types';
import { saleBalance, salePaid, saleReceipt } from '../src/pages/SalesPage';

function returnedOrder(): Sale {
  return {
    id: 'order-1', number: 'SL-0001', date: '2026-09-30', completedDate: '2026-09-30',
    cancelledDate: '2026-10-02', customerId: 'customer-1', channel: 'Instagram',
    paymentMethod: 'Transferencia', status: 'void', source: 'pos',
    items: [{ id: 'line-1', variantId: 'variant-1', productName: 'Conjunto Valentina',
      variantLabel: 'Talle 95 · Rojo', quantity: 2, unitPrice: 10_000, unitCost: 4_000,
      costTotal: 8_000, total: 20_000, netTotal: 18_000, discount: 2_000, returnedQuantity: 2 }],
    shippingCost: 500, packagingCost: 100, discount: 2_000, discountKind: 'percent',
    discountValue: 1_000, commissionRate: 300, commissionCost: 540,
    directCostMethod: 'Efectivo', directCostsPaid: true, total: 18_000,
    costTotal: 8_000, balance: -13_000, paid: 18_000, refunded: 5_000, returnedRevenue: 18_000,
  };
}

describe('order display after physical return and partial refund', () => {
  it('preserves signed credit and original cash history even when cancelled', () => {
    const sale = returnedOrder();
    const data: Snapshot = { ...EMPTY_SNAPSHOT, sales: [sale], payments: [
      { id: 'receipt-1', saleId: sale.id, date: '2026-09-30', amount: 18_000,
        method: 'Transferencia', kind: 'receipt', commission: 540 },
      { id: 'refund-1', saleId: sale.id, date: '2026-10-02', amount: 5_000,
        method: 'Efectivo', kind: 'refund', commission: 0 },
      { id: 'unrelated', saleId: 'order-2', date: '2026-10-02', amount: 8_000,
        method: 'QR', kind: 'receipt', commission: 80 },
    ] };
    expect(salePaid(data, sale.id)).toBe(13_000);
    expect(saleBalance(data, sale)).toBe(-13_000);
    expect(data.payments[0].commission).toBe(540);
  });

  it('keeps original sale, return quantities and refund credit visible on receipt', () => {
    const receipt = saleReceipt(returnedOrder(), 'María');
    expect(receipt).toContain('Sou Linda System');
    expect(receipt).toContain('Estado: Cancelado');
    expect(receipt).toContain('TOTAL ORIGINAL:');
    expect(receipt).toContain('Descuento incluido:');
    expect(receipt).toContain('Unidades devueltas: 2');
    expect(receipt).toContain('Créditos por devoluciones:');
    expect(receipt).toContain('a favor');
    expect(receipt).toContain('No válido como factura fiscal');
    expect(receipt).not.toContain('CMV');
  });
});
