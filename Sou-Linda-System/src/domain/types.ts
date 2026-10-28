export const CHANNELS = ['Instagram', 'WhatsApp', 'TikTok', 'Local'] as const;
export const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Tarjeta', 'QR', 'Crédito'] as const;
export type Channel = typeof CHANNELS[number];
export type PaymentMethod = typeof PAYMENT_METHODS[number];
export type PaidMethod = Exclude<PaymentMethod, 'Crédito'>;
/** All monetary fields use integer cents; dates use local YYYY-MM-DD. */
export interface Product { id: string; name: string; category: string; createdAt: string }
export interface Variant { id: string; productId: string; sku: string; size: string; color: string; cost: number; retailPrice: number; wholesalePrice: number; stock: number; reserved: number; available: number; inventoryValue: number; minStock: number; active: boolean }
export interface Customer { id: string; name: string; phone: string; social: string; preferredSize: string; createdAt: string }
export type SaleStatus = 'pending' | 'reserved' | 'completed' | 'void';
export interface SaleItem { id: string; variantId: string; productName: string; variantLabel: string; quantity: number; unitPrice: number; unitCost: number | null; costTotal: number | null; total: number; netTotal: number; discount: number; returnedQuantity: number }
export interface Sale { id: string; number: string; date: string; completedDate?: string; cancelledDate?: string; customerId?: string; customerName?: string; channel: Channel; paymentMethod: PaymentMethod; items: SaleItem[]; shippingCost: number; packagingCost: number; discount: number; discountKind: 'fixed' | 'percent'; discountValue: number; commissionRate: number; commissionCost: number; directCostMethod: PaidMethod; directCostsPaid: boolean; total: number; costTotal: number | null; balance: number; paid: number; refunded: number; returnedRevenue: number; status: SaleStatus; source: 'pos' | 'import'; sourceKey?: string }
export interface Payment { id: string; saleId: string; date: string; amount: number; method: PaidMethod; kind: 'receipt' | 'refund'; commission: number }
export interface Expense { id: string; date: string; category: string; description: string; amount: number; paymentMethod: PaidMethod; paid: boolean; costType: 'fixed' | 'variable'; channel?: Channel }
export interface StockMovement { id: string; variantId: string; date: string; quantity: number; type: 'opening' | 'purchase' | 'adjustment' | 'sale' | 'return'; reference?: string; note: string }
export interface CashClosing { id: string; date: string; openingCash: number; expectedCash: number; countedCash: number; difference: number; note: string }
export interface Setting { key: string; value: string }
export interface SaleDraft { date: string; customerId?: string; channel: Channel; paymentMethod: PaymentMethod; items: { variantId: string; quantity: number; unitPrice: number }[]; shippingCost: number; packagingCost: number; discount: number; discountKind?: 'fixed' | 'percent'; discountValue?: number; commissionRate?: number; status?: Exclude<SaleStatus, 'void'>; directCostMethod?: PaidMethod; directCostsPaid?: boolean; commandId?: string; notes?: string }
export interface Snapshot { products: Product[]; variants: Variant[]; customers: Customer[]; sales: Sale[]; expenses: Expense[]; movements: StockMovement[]; payments: Payment[]; cashClosings: CashClosing[]; settings: Setting[] }
export const EMPTY_SNAPSHOT: Snapshot = { products: [], variants: [], customers: [], sales: [], expenses: [], movements: [], payments: [], cashClosings: [], settings: [] };
