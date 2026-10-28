import { afterEach, describe, expect, it } from 'vitest';
import { validateDailyReport, validateMonthlyReport, type DailyReport, type MonthlyReport } from '../src/data/reports';
import { configureCurrency, currencyCode } from '../src/domain/format';

function monthly(): MonthlyReport {
  return {
    currency:'PYG', month:'2026-02', revenue_cents:5_000_000, cogs_cents:3_000_000,
    commission_cents:0, shipping_cents:0, packaging_cents:0, operating_cents:0, loss_cents:0,
    gross_profit_cents:2_000_000, net_profit_cents:2_000_000, known_result_cents:2_000_000,
    incomplete_cost_count:0, sales_count:1, average_ticket_cents:5_000_000,
    new_sales_cents:5_000_000, discount_cents:0, shared_expense_cents:0, unallocated_expense_cents:0,
    allocation_mode:'none', previous_revenue_cents:0, outstanding_cents:0, customer_credit_cents:0, advances_cents:0,
    channels: (['Instagram','WhatsApp','TikTok','Local'] as const).map(channel=>({
      channel,revenue_cents:0,cogs_cents:0,commission_cents:0,shipping_cents:0,packaging_cents:0,
      attributed_expense_cents:0,contribution_cents:0,shared_allocated_cents:0,profit_cents:0,
      incomplete_cost_count:0,sales_count:0,
    })),
    daily:Array.from({length:28},(_,index)=>({date:`2026-02-${String(index+1).padStart(2,'0')}`,total_cents:0})),
  };
}
function daily(): DailyReport {
  return {
    currency:'PYG',business_date:'2026-02-01',expected_cash_cents:5_000_000,
    credit_sales_cents:0,receipts_cents:5_000_000,expenses_cents:0,closing:null,closing_count:0,late_movements_count:0,
    by_method:(['Efectivo','Transferencia','Tarjeta','QR'] as const).map(method=>({method,income_cents:0,expense_cents:0,balance_cents:0})),
  };
}

afterEach(()=>configureCurrency('PYG'));

describe('moneda y precisión de los reportes',()=>{
  it('conserva PYG y sus importes fijos sin convertirlos',()=>{
    const report=validateMonthlyReport(monthly());
    expect(report.currency).toBe('PYG');
    expect(report.revenue_cents).toBe(5_000_000);
    expect(validateDailyReport(daily()).currency).toBe('PYG');
  });
  it('identifica como ARS los reportes anteriores sin moneda y conserva sus fracciones',()=>{
    const old:Partial<MonthlyReport>=monthly();delete old.currency;old.revenue_cents=123_456;
    expect(validateMonthlyReport(old).currency).toBe('ARS');
    expect(validateMonthlyReport(old).revenue_cents).toBe(123_456);
    const oldCash:Partial<DailyReport>=daily();delete oldCash.currency;oldCash.receipts_cents=12_345;
    expect(validateDailyReport(oldCash).currency).toBe('ARS');
    expect(validateDailyReport(oldCash).receipts_cents).toBe(12_345);
  });
  it('rechaza una moneda desconocida sin cambiar el formato del negocio',()=>{
    configureCurrency('PYG');
    expect(()=>validateMonthlyReport({...monthly(),currency:'USD'})).toThrow('moneda desconocida');
    expect(()=>validateDailyReport({...daily(),currency:null})).toThrow('moneda desconocida');
    expect(currencyCode()).toBe('PYG');
  });
  it('evita que un saldo PYG se oculte mediante redondeo visual',()=>{
    expect(()=>validateMonthlyReport({...monthly(),outstanding_cents:101})).toThrow('fracción inválida');
    const report=monthly();report.channels[0].shared_allocated_cents=50;
    expect(()=>validateMonthlyReport(report)).toThrow('fracción inválida');
    const byDay=monthly();byDay.daily[0].total_cents=1;
    expect(()=>validateMonthlyReport(byDay)).toThrow('fracción inválida');
    expect(()=>validateDailyReport({...daily(),receipts_cents:1})).toThrow('fracción inválida');
  });
  it('valida primero el reporte completo y deja la selección de moneda al consumidor activo',()=>{
    configureCurrency('PYG');
    expect(validateMonthlyReport({...monthly(),currency:'ARS'}).currency).toBe('ARS');
    expect(currencyCode()).toBe('PYG');
    expect(()=>validateMonthlyReport({...monthly(),currency:'ARS',daily:[]})).toThrow();
    expect(currencyCode()).toBe('PYG');
  });
});
