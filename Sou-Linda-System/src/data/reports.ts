import { useEffect, useReducer, useState } from 'react';
import { api } from './api';
import type { Channel, PaidMethod } from '../domain/types';

export interface ChannelReport {
  channel: Channel;
  revenue_cents: number;
  cogs_cents: number;
  commission_cents: number;
  shipping_cents: number;
  packaging_cents: number;
  attributed_expense_cents: number;
  contribution_cents: number | null;
  shared_allocated_cents: number;
  profit_cents: number | null;
  incomplete_cost_count: number;
  sales_count: number;
}

export interface MonthlyReport {
  month: string;
  revenue_cents: number;
  cogs_cents: number;
  commission_cents: number;
  shipping_cents: number;
  packaging_cents: number;
  operating_cents: number;
  loss_cents: number;
  gross_profit_cents: number | null;
  net_profit_cents: number | null;
  known_result_cents: number;
  incomplete_cost_count: number;
  incomplete_order_ids?: string[];
  sales_count: number;
  average_ticket_cents: number;
  new_sales_cents: number;
  discount_cents: number;
  channels: ChannelReport[];
  shared_expense_cents: number;
  unallocated_expense_cents: number;
  allocation_mode: 'none' | 'net_revenue_proportion';
  daily: { date: string; total_cents: number }[];
  previous_revenue_cents: number;
  outstanding_cents: number;
  customer_credit_cents: number;
  advances_cents: number;
  before_tax?: boolean;
}

export interface CashClosingReport {
  id: string;
  business_date: string;
  opening_cents: number;
  expected_cents: number;
  counted_cents: number;
  difference_cents: number;
  cutoff_sequence: number;
  note: string;
  created_at: string;
  revision_number?: number;
}

export interface DailyReport {
  business_date: string;
  by_method: { method: PaidMethod; income_cents: number; expense_cents: number; balance_cents: number }[];
  expected_cash_cents: number;
  credit_sales_cents: number;
  receipts_cents: number;
  expenses_cents: number;
  closing: CashClosingReport | null;
  closing_count: number;
  late_movements_count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function requireIntegers(record: Record<string, unknown>, fields: string[], nullable: string[] = []) {
  for (const field of fields) {
    if (nullable.includes(field) && record[field] === null) continue;
    if (!Number.isSafeInteger(record[field])) throw new Error(`El informe contiene un importe o conteo inválido (${field}). No se muestran totales aproximados.`);
  }
}
function daysInMonth(month: string) {
  const year = Number(month.slice(0, 4)), number = Number(month.slice(5));
  if (number === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(number) ? 30 : 31;
}
function validMonth(value: unknown): value is string {
  return typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !validMonth(value.slice(0, 7))) return false;
  const day = Number(value.slice(8));
  return day >= 1 && day <= daysInMonth(value.slice(0, 7));
}
function requireCounts(record: Record<string, unknown>, fields: string[]) {
  for (const field of fields) if (Number(record[field]) < 0) throw new Error(`El informe contiene un conteo negativo (${field}).`);
}
function validateProfitAvailability(record: Record<string, unknown>, fields: string[]) {
  const incomplete = Number(record.incomplete_cost_count) > 0;
  if (fields.some(field => incomplete !== (record[field] === null))) throw new Error('El estado de costos históricos del informe no coincide con su ganancia.');
}

/** Validate transport precision; the Python/SQLite engine remains authoritative. */
export function validateMonthlyReport(value: unknown): MonthlyReport {
  if (!isRecord(value) || !validMonth(value.month)) throw new Error('La notebook devolvió un informe mensual inválido.');
  requireIntegers(value, ['revenue_cents', 'cogs_cents', 'commission_cents', 'shipping_cents', 'packaging_cents', 'operating_cents', 'loss_cents', 'gross_profit_cents', 'net_profit_cents', 'known_result_cents', 'incomplete_cost_count', 'sales_count', 'average_ticket_cents', 'new_sales_cents', 'discount_cents', 'shared_expense_cents', 'unallocated_expense_cents', 'previous_revenue_cents', 'outstanding_cents', 'customer_credit_cents', 'advances_cents'], ['gross_profit_cents', 'net_profit_cents']);
  requireCounts(value, ['incomplete_cost_count', 'sales_count']);
  validateProfitAvailability(value, ['gross_profit_cents', 'net_profit_cents']);
  if (!Array.isArray(value.channels) || !Array.isArray(value.daily) || !['none', 'net_revenue_proportion'].includes(String(value.allocation_mode))) throw new Error('El detalle del informe mensual está incompleto.');
  const channels = new Set<string>();
  for (const row of value.channels) {
    if (!isRecord(row) || typeof row.channel !== 'string' || !['Instagram', 'WhatsApp', 'TikTok', 'Local'].includes(row.channel) || channels.has(row.channel)) throw new Error('El informe contiene un canal desconocido o repetido.');
    channels.add(row.channel);
    requireIntegers(row, ['revenue_cents', 'cogs_cents', 'commission_cents', 'shipping_cents', 'packaging_cents', 'attributed_expense_cents', 'contribution_cents', 'shared_allocated_cents', 'profit_cents', 'incomplete_cost_count', 'sales_count'], ['contribution_cents', 'profit_cents']);
    requireCounts(row, ['incomplete_cost_count', 'sales_count']);
    validateProfitAvailability(row, ['contribution_cents', 'profit_cents']);
  }
  const dates = new Set<string>();
  for (const row of value.daily) {
    if (!isRecord(row) || !validDate(row.date) || !row.date.startsWith(`${value.month}-`) || dates.has(row.date)) throw new Error('El informe contiene una fecha diaria inválida o repetida.');
    dates.add(row.date);
    requireIntegers(row, ['total_cents']);
  }
  if (channels.size !== 4 || dates.size !== daysInMonth(value.month)) throw new Error('Faltan canales o días en el informe mensual.');
  return value as unknown as MonthlyReport;
}

export function validateDailyReport(value: unknown): DailyReport {
  if (!isRecord(value) || !validDate(value.business_date) || !Array.isArray(value.by_method)) throw new Error('El informe de caja está incompleto.');
  requireIntegers(value, ['expected_cash_cents', 'credit_sales_cents', 'receipts_cents', 'expenses_cents', 'closing_count', 'late_movements_count']);
  requireCounts(value, ['closing_count', 'late_movements_count']);
  const methods = new Set<string>();
  for (const row of value.by_method) {
    if (!isRecord(row) || typeof row.method !== 'string' || !['Efectivo', 'Transferencia', 'Tarjeta', 'QR'].includes(row.method) || methods.has(row.method)) throw new Error('El informe contiene un medio de pago desconocido o repetido.');
    methods.add(row.method);
    requireIntegers(row, ['income_cents', 'expense_cents', 'balance_cents']);
  }
  if (methods.size !== 4) throw new Error('Faltan medios de pago en el informe de caja.');
  if (value.closing !== null) {
    if (!isRecord(value.closing) || value.closing.business_date !== value.business_date) throw new Error('El arqueo guardado no es válido.');
    requireIntegers(value.closing, ['opening_cents', 'expected_cents', 'counted_cents', 'difference_cents', 'cutoff_sequence']);
  }
  return value as unknown as DailyReport;
}

interface ReportState<T> { path: string; report: T | null; loading: boolean; error: string | null; updatedAt: Date | null }
function useReport<T>(path: string | null, validate: (value: unknown) => T) {
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const [state, setState] = useState<ReportState<T>>({ path: '', report: null, loading: true, error: null, updatedAt: null });
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState !== 'hidden') refresh(); };
    window.addEventListener('sadi:data-changed', refresh);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('sadi:data-changed', refresh);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);
  useEffect(() => {
    if (!path) return;
    let active = true;
    const controller = new AbortController();
    setState(previous => ({ path, report: previous.path === path ? previous.report : null, loading: true, error: null, updatedAt: previous.path === path ? previous.updatedAt : null }));
    void api<unknown>(path, { signal: controller.signal })
      .then(validate)
      .then(report => { if (active) setState({ path, report, loading: false, error: null, updatedAt: new Date() }); })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState(previous => ({ ...previous, path, loading: false, error: error instanceof Error ? error.message : 'No pudimos consultar los datos de la notebook.' }));
      });
    return () => { active = false; controller.abort(); };
  }, [path, revision, validate]);
  return { report: path && state.path === path ? state.report : null, loading: Boolean(path) && (state.path !== path || state.loading), error: path ? state.path === path ? state.error : null : 'Seleccioná una fecha o importe válido.', updatedAt: state.path === path ? state.updatedAt : null, refresh };
}

export function useMonthlyReport(month: string, allocateShared = false) {
  const valid = validMonth(month);
  return useReport<MonthlyReport>(valid ? `/reports/monthly?month=${encodeURIComponent(month)}&allocate_shared=${allocateShared ? 'true' : 'false'}` : null, validateMonthlyReport);
}

export function useDailyReport(date: string, openingCents: number | null) {
  const valid = validDate(date) && openingCents !== null && Number.isSafeInteger(openingCents) && openingCents >= 0;
  return useReport<DailyReport>(valid ? `/reports/daily?date=${encodeURIComponent(date)}&opening=${openingCents}` : null, validateDailyReport);
}

export function toDashboardSummary(report: MonthlyReport) {
  return {
    salesTotal: report.revenue_cents,
    costTotal: report.cogs_cents,
    operatingExpenses: report.operating_cents,
    saleExpenses: report.commission_cents + report.shipping_cents + report.packaging_cents,
    grossProfit: report.gross_profit_cents,
    netProfit: report.net_profit_cents,
    averageTicket: report.average_ticket_cents,
    salesCount: report.sales_count,
    outstanding: report.outstanding_cents,
    channels: report.channels.map(row => ({ channel: row.channel, revenue: row.revenue_cents, profit: row.profit_cents, count: row.sales_count })),
    daily: report.daily.map(row => ({ date: row.date, total: row.total_cents })),
    previousSalesTotal: report.previous_revenue_cents,
  };
}
