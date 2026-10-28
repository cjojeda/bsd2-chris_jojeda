import { api, mutate } from '../data/api';
import type { CashClosing, Customer, Expense, PaidMethod, Sale, SaleDraft } from './types';
export interface VariantInput { productId?: string; variantId?: string; name: string; category: string; sku: string; size: string; color: string; cost: number; retailPrice: number; wholesalePrice: number; stock: number; minStock: number }
export async function saveVariant(input: VariantInput): Promise<void> { await mutate('/variants', input); }
export async function saveCustomer(input: Omit<Customer,'id'|'createdAt'> & {id?:string}): Promise<void> { await mutate('/customers', input); }
export const recordSale = (draft: SaleDraft): Promise<Sale> => mutate('/sales', draft);
export async function reserveSale(id:string): Promise<void>{await mutate(`/sales/${encodeURIComponent(id)}/reserve`,{});}
export async function releaseSale(id:string): Promise<void>{await mutate(`/sales/${encodeURIComponent(id)}/release`,{});}
export async function completeSale(id:string): Promise<void>{await mutate(`/sales/${encodeURIComponent(id)}/complete`,{});}
export async function voidSale(id:string,confirmReturn=false):Promise<void>{await mutate(`/sales/${encodeURIComponent(id)}/cancel`,{confirmReturn});}
export async function returnSale(id:string,items:Record<string,number>|null,date?:string,commandId?:string):Promise<void>{await mutate(`/sales/${encodeURIComponent(id)}/return`,{items,date,commandId});}
export async function recordPayment(id:string,amount:number,method:PaidMethod,date:string,commissionRate=0,commandId?:string):Promise<void>{await mutate(`/sales/${encodeURIComponent(id)}/payment`,{amount,method,date,commissionRate,commandId});}
export async function recordRefund(id:string,amount:number,method:PaidMethod,date:string,commandId?:string):Promise<void>{await mutate(`/sales/${encodeURIComponent(id)}/refund`,{amount,method,date,commandId});}
export async function payDirectCosts(id:string,method:PaidMethod,date:string,commandId?:string):Promise<void>{await mutate(`/sales/${encodeURIComponent(id)}/direct-costs/pay`,{method,date,commandId});}
export async function saveExpense(input:Omit<Expense,'id'>):Promise<void>{await mutate('/expenses',input);}
export async function payExpense(id:string,method:PaidMethod,date:string):Promise<void>{await mutate(`/expenses/${encodeURIComponent(id)}/pay`,{method,date});}
export async function closeCash(input:{date:string;openingCash:number;countedCash:number;note:string;allowRevision?:boolean}):Promise<CashClosing>{return mutate('/cash-close',input);}
export interface ReceiptInput { variantId:string;quantity:number;totalCost:number;note:string;date?:string;paid:boolean;paymentMethod:PaidMethod;commandId?:string }
export async function receiveStock(input:ReceiptInput):Promise<void>{await mutate('/inventory/receive',input);}
export async function adjustStock(input:{variantId:string;delta:number;totalCost?:number;note:string;date?:string;commandId?:string}):Promise<void>{await mutate('/inventory/adjust',input);}
export interface Purchase {id:string;business_date:string;variant_id:string;model?:string;sku?:string;quantity:number;total_cost_cents:number;note:string;paid:boolean|number;method:string}
export const listPurchases=():Promise<Purchase[]>=>api('/purchases');
export async function payPurchase(id:string,method:PaidMethod,date:string):Promise<void>{await mutate(`/purchases/${encodeURIComponent(id)}/pay`,{method,date});}
export async function loadDraft():Promise<unknown|null>{const result=await api<{draft:unknown|null}>('/drafts/pos');return result.draft;}
export async function saveDraft(draft:unknown):Promise<void>{await api('/drafts/pos',{method:'POST',body:JSON.stringify({draft})});}
export async function clearDraft():Promise<void>{await api('/drafts/pos',{method:'POST',body:JSON.stringify({draft:null})});}
