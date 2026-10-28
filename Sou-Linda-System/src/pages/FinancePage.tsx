import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Wallet, ChartNoAxesCombined, Check, Scale, RefreshCw, AlertCircle } from 'lucide-react';
import { CHANNELS, PAYMENT_METHODS, type Snapshot, type PaidMethod, type Expense, type Channel } from '../domain/types';
import { money, cents, localDate, displayDate } from '../domain/format';
import { saveExpense, payExpense } from '../domain/services';
import { mutate } from '../data/api';
import { useDailyReport, useMonthlyReport, type CashClosingReport } from '../data/reports';
import { Modal, Field, EmptyState } from '../components/ui';

type Props = { data: Snapshot; notify: (message: string, kind?: 'success' | 'error') => void; month: string; setMonth: (month: string) => void; initialTab?:'month'|'daily'; openExpense?:boolean };
const paidMethods = PAYMENT_METHODS.filter((method): method is PaidMethod => method !== 'Crédito');
const errorText = (error: unknown) => error instanceof Error ? error.message : 'No pudimos completar la operación.';
function readOpening(value: string): number | null { try { return value.trim() ? cents(value) : null; } catch { return null; } }

export default function FinancePage({ data, notify, month, setMonth, initialTab='month', openExpense=false }: Props) {
  const [tab, setTab] = useState<'month' | 'daily'>(initialTab);
  const [expenseModal, setExpenseModal] = useState(openExpense);
  const [paying, setPaying] = useState<Expense | null>(null);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(localDate());
  const [opening, setOpening] = useState('0');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [allowRevision, setAllowRevision] = useState(false);
  const [allocateShared, setAllocateShared] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const monthly = useMonthlyReport(month, allocateShared);
  const openingCents = useMemo(() => readOpening(opening), [opening]);
  const daily = useDailyReport(date, openingCents);
  const m = monthly.report, cash = daily.report;
  const expenses = data.expenses.filter(expense => expense.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
  const existingClose = cash?.closing;

  async function close(event: FormEvent) {
    event.preventDefault();
    if (!cash || openingCents === null) return;
    if (existingClose && !allowRevision) { notify('Marcá la rectificación explícita para conservar el cierre anterior.', 'error'); return; }
    setBusy(true);
    try {
      await mutate<CashClosingReport>('/cash-close', { date, openingCash: openingCents, countedCash: cents(counted), note, allowRevision });
      notify(existingClose ? 'Rectificación guardada. El cierre anterior se conserva.' : 'Arqueo guardado.');
      setAllowRevision(false); daily.refresh();
    } catch (error) { notify(errorText(error), 'error'); } finally { setBusy(false); }
  }
  async function addExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget); setBusy(true);
    try {
      await saveExpense({ date: String(f.get('date')), category: String(f.get('category')), description: String(f.get('description')), amount: cents(String(f.get('amount'))), paymentMethod: String(f.get('paymentMethod')) as PaidMethod, paid: f.get('paid') === 'on', costType: f.get('costType') === 'fixed' ? 'fixed' : 'variable', ...(f.get('channel') ? { channel: String(f.get('channel')) as Channel } : {}) });
      setExpenseModal(false); notify('Gasto registrado. Su pago solo modifica caja si lo marcaste como pagado.'); monthly.refresh(); daily.refresh();
    } catch (error) { notify(errorText(error), 'error'); } finally { setBusy(false); }
  }
  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!paying) return; const f = new FormData(event.currentTarget); setBusy(true);
    try { await payExpense(paying.id, String(f.get('method')) as PaidMethod, String(f.get('date'))); notify('Pago registrado en caja, sin descontar el gasto dos veces.'); setPaying(null); daily.refresh(); }
    catch (error) { notify(errorText(error), 'error'); } finally { setBusy(false); }
  }

  return <>
    <div className="page-heading"><div><p className="eyebrow">CLARIDAD PARA DECIDIR</p><h1>Finanzas<span className="heading-dot">.</span></h1><p className="page-subtitle">Costos históricos, ganancia y caja. Cada movimiento en su lugar.</p></div><button className="btn btn-primary" onClick={() => setExpenseModal(true)}><Plus size={18} />Registrar gasto</button></div>
    <div className="tabs"><button className={tab === 'month' ? 'active' : ''} onClick={() => setTab('month')}><ChartNoAxesCombined size={17} />Corte mensual</button><button className={tab === 'daily' ? 'active' : ''} onClick={() => setTab('daily')}><Wallet size={17} />Caja diaria</button></div>
    {tab === 'month' ? <>
      <div className="period-toolbar"><h2>La foto completa de tu negocio</h2><input type="month" aria-label="Mes de finanzas" value={month} onChange={e => e.target.value && setMonth(e.target.value)} /></div>
      {monthly.error && <ReportError message={monthly.error} stale={Boolean(m)} retry={monthly.refresh} />}
      {!m && monthly.loading && <p className="info-banner" role="status">Consultando los registros de la notebook…</p>}
      {m && <>
        {monthly.loading && <p className="muted report-updating" role="status">Actualizando el informe…</p>}
        {m.incomplete_cost_count > 0 && <div className="info-banner report-warning" role="status"><AlertCircle size={18} /><span>{m.incomplete_cost_count} ventas o devoluciones sin costo histórico completo. La ganancia real permanece pendiente; no se supone costo cero.</span></div>}
        <div className="finance-overview"><section className="panel profit-breakdown"><div className="panel-head"><div><h2>De ventas a ganancia</h2><p>Por fecha del hecho económico, incluyendo fiado y devoluciones.</p></div><ChartNoAxesCombined size={22} /></div><div className="breakdown-lines">
          <div><span>Ingresos netos del mes</span><strong>{money(m.revenue_cents)}</strong></div><div><span>− Costo de mercadería vendida</span><strong>{money(m.cogs_cents)}</strong></div><div className="breakdown-subtotal"><span>Ganancia bruta</span><strong>{m.gross_profit_cents === null ? 'Pendiente de costos' : money(m.gross_profit_cents)}</strong></div><div><span>− Comisiones efectivas</span><strong>{money(m.commission_cents)}</strong></div><div><span>− Envíos asumidos</span><strong>{money(m.shipping_cents)}</strong></div><div><span>− Packaging</span><strong>{money(m.packaging_cents)}</strong></div><div><span>− Gastos operativos</span><strong>{money(m.operating_cents)}</strong></div><div><span>− Pérdidas de inventario</span><strong>{money(m.loss_cents)}</strong></div><div className="breakdown-total"><span>Ganancia neta de gestión<small>Antes de impuestos no registrados en Sou Linda System.</small></span><strong className={m.net_profit_cents !== null && m.net_profit_cents < 0 ? 'danger-text' : ''}>{m.net_profit_cents === null ? 'Incompleta' : money(m.net_profit_cents)}</strong></div>
        </div></section><section className="panel financial-notes"><div className="panel-head"><h2>Los números, en contexto</h2></div><div className="financial-kpi"><div><small>Ticket promedio · ventas nuevas</small><strong>{money(m.average_ticket_cents)}</strong><small>{m.sales_count} operaciones completadas · Descuentos: {money(m.discount_cents)}</small></div></div><div className="financial-kpi"><div><small>Por cobrar · todo el historial</small><strong>{money(m.outstanding_cents)}</strong><small>Crédito a favor: {money(m.customer_credit_cents)}</small><small>Anticipos sin entrega: {money(m.advances_cents)}</small></div></div><div className="financial-kpi"><div><small>Margen neto del período</small><strong>{m.net_profit_cents === null ? 'Pendiente de costos' : m.revenue_cents > 0 ? `${(m.net_profit_cents / m.revenue_cents * 100).toFixed(1).replace('.', ',')} %` : 'Sin base positiva'}</strong></div></div><p className="accounting-note">El ingreso neto ya incluye descuentos y devoluciones del período. Una compra aumenta inventario; su costo se reconoce al vender. No la vuelvas a registrar como gasto operativo.</p></section></div>
        <section className="panel financial-chart-panel"><div className="panel-head"><div><h2>Ventas y devoluciones, día a día</h2><p>Seleccioná una barra para consultar su importe neto.</p></div></div><DailyRevenueChart rows={m.daily} selected={selectedDay} onSelect={setSelectedDay} /><div className="chart-bottom"><span>{selectedDay && m.daily.some(day => day.date === selectedDay) ? `${displayDate(selectedDay)} · ${money(m.daily.find(day => day.date === selectedDay)!.total_cents)}` : 'Las devoluciones pueden producir días con ingresos negativos.'}</span><span>Los cobros están en Caja diaria.</span></div></section>
        <section className="panel"><div className="panel-head"><div><h2>Rentabilidad por canal</h2><p>{allocateShared ? 'Resultado tras asignar gastos compartidos por ventas netas positivas.' : 'Resultado después de costos directos y gastos atribuibles; compartidos por separado.'}</p></div></div><div className="report-allocation"><label><input type="checkbox" checked={allocateShared} onChange={e => setAllocateShared(e.target.checked)} />Prorratear gastos compartidos por ventas netas</label><span>Sin asignar: {money(m.unallocated_expense_cents)}</span></div><div className="table-wrap"><table><thead><tr><th>CANAL</th><th className="align-right">VENTAS NETAS</th><th className="align-right">CMV + COSTOS DIRECTOS</th><th className="align-right">ATRIBUIBLES</th><th className="align-right">COMPARTIDOS</th><th className="align-right">RESULTADO</th></tr></thead><tbody>{m.channels.map(row => <tr key={row.channel}><td><strong>{row.channel === 'Local' ? 'Venta presencial' : row.channel}</strong><small className="report-table-note">{row.sales_count} ventas nuevas</small></td><td className="align-right">{money(row.revenue_cents)}</td><td className="align-right">{money(row.cogs_cents + row.commission_cents + row.shipping_cents + row.packaging_cents)}</td><td className="align-right">{money(row.attributed_expense_cents)}</td><td className="align-right">{money(row.shared_allocated_cents)}</td><td className={`align-right ${row.profit_cents !== null && row.profit_cents < 0 ? 'danger-text' : ''}`}><strong>{row.profit_cents === null ? 'Incompleto' : money(row.profit_cents)}</strong></td></tr>)}</tbody></table></div><p className="accounting-note">Los reintegros pueden volver negativos los gastos del mes. El reparto conserva centavos y signo; si no hay ventas netas positivas, el gasto queda sin asignar.</p></section>
      </>}
      <section className="panel"><div className="panel-head"><div><h2>Gastos operativos</h2><p>Publicidad, alquiler, servicios y otros gastos del mes.</p></div><span className="badge badge-neutral">{expenses.length} registros</span></div>{expenses.length ? <div className="table-wrap"><table><thead><tr><th>FECHA</th><th>DESCRIPCIÓN</th><th>CATEGORÍA / TIPO</th><th>CANAL</th><th>PAGO</th><th className="align-right">IMPORTE</th><th /></tr></thead><tbody>{expenses.map(expense => <tr key={expense.id}><td>{displayDate(expense.date)}</td><td><strong>{expense.description}</strong></td><td><span className="badge badge-neutral">{expense.category}</span><small className="report-table-note">{expense.costType === 'fixed' ? 'Fijo' : 'Variable'}</small></td><td className="muted">{expense.channel || 'Compartido'}</td><td><span className={`badge ${expense.paid ? 'badge-success' : 'badge-warning'}`}>{expense.paid ? `Pagado · ${expense.paymentMethod}` : 'Pendiente'}</span></td><td className="align-right">{money(expense.amount)}</td><td>{!expense.paid && <button className="btn btn-secondary btn-small" onClick={() => setPaying(expense)}>Registrar pago</button>}</td></tr>)}</tbody></table></div> : <EmptyState title="Todo gasto merece su lugar" detail="Registrá gastos para que el resultado refleje tu negocio real." action={<button className="btn btn-secondary" onClick={() => setExpenseModal(true)}>Registrar primer gasto</button>} />}</section>
    </> : <>
      <div className="period-toolbar"><h2>Tu caja, al día</h2><input type="date" aria-label="Fecha del arqueo" value={date} onChange={e => { if (e.target.value) { setDate(e.target.value); setAllowRevision(false); } }} /></div>
      {daily.error && <ReportError message={daily.error} stale={Boolean(cash)} retry={daily.refresh} />}
      {daily.loading && <p className="muted report-updating" role="status">Actualizando movimientos de caja…</p>}
      {cash && <div className="stat-grid daily-stats">
        <article className="stat-card"><span className="muted">Ingresos efectivos</span><div className="stat-value">{money(cash.receipts_cents)}</div><p>Incluye anticipos y cobros de fiado registrados.</p></article>
        <article className="stat-card"><span className="muted">Egresos efectivos</span><div className="stat-value">{money(cash.expenses_cents)}</div><p>Pagos, compras, costos y reembolsos.</p></article>
        <article className="stat-card stat-rose"><span className="muted">Ventas nuevas a crédito</span><div className="stat-value">{money(cash.credit_sales_cents)}</div><p>Reconocen una venta; no inventan un cobro.</p></article>
      </div>}
      <div className="finance-overview">
        <section className="panel">
          <div className="panel-head"><div><h2>Movimientos por medio de pago</h2><p>Dinero real, separado de la rentabilidad.</p></div><Wallet size={21} /></div>
          {cash ? <div className="table-wrap"><table><thead><tr><th>MEDIO</th><th className="align-right">INGRESOS</th><th className="align-right">EGRESOS</th><th className="align-right">BALANCE</th></tr></thead><tbody>{cash.by_method.map(row => <tr key={row.method}><td><strong>{row.method}</strong></td><td className="align-right">{money(row.income_cents)}</td><td className="align-right">{money(row.expense_cents)}</td><td className={`align-right ${row.balance_cents < 0 ? 'danger-text' : ''}`}>{money(row.balance_cents)}</td></tr>)}</tbody></table></div> : <p className="accounting-note">{openingCents === null ? 'Ingresá un fondo inicial válido para consultar la caja.' : 'Consultando los movimientos del día…'}</p>}
          <p className="accounting-note">La comisión retenida se registra con su cobro y su egreso. Envío y packaging usan el medio elegido y solo salen de caja si indicás que fueron pagados.</p>
        </section>
        <section className="panel cash-count">
          <div className="panel-head"><div><h2><Scale size={19} />Arqueo de efectivo</h2><p>Compará lo contado con lo registrado.</p></div></div>
          {existingClose && <div className="saved-closing"><span className="badge badge-success"><Check size={13} />{(cash?.closing_count ?? 0) > 1 ? `${cash?.closing_count} cierres conservados` : 'Arqueo guardado'}</span><dl><div><dt>Fondo inicial</dt><dd>{money(existingClose.opening_cents)}</dd></div><div><dt>Efectivo esperado al cerrar</dt><dd>{money(existingClose.expected_cents)}</dd></div><div><dt>Efectivo contado</dt><dd>{money(existingClose.counted_cents)}</dd></div><div className={existingClose.difference_cents ? 'danger-text' : 'positive-text'}><dt>Diferencia</dt><dd>{money(existingClose.difference_cents)}</dd></div></dl>{existingClose.note && <p className="muted">{existingClose.note}</p>}<small>{cash?.late_movements_count ? `${cash.late_movements_count} movimientos se registraron después del corte.` : 'Se conserva la foto del momento en que lo guardaste.'}</small></div>}
          <form onSubmit={close}>
            <Field label="Fondo inicial (ARS)" hint="No vuelvas a sumarlo como ingreso del día."><input type="number" min="0" step="0.01" value={opening} onChange={e => setOpening(e.target.value)} required /></Field>
            <div className="cash-expected"><span>Efectivo esperado ahora</span><strong>{cash ? money(cash.expected_cash_cents) : openingCents === null ? 'Ingresá el fondo' : 'Consultando…'}</strong></div>
            <Field label="Efectivo contado (ARS)"><input type="number" min="0" step="0.01" placeholder="0,00" value={counted} onChange={e => setCounted(e.target.value)} required /></Field>
            <Field label="Nota del arqueo (opcional)"><textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={2} /></Field>
            {existingClose && <label className="report-checkbox"><input type="checkbox" checked={allowRevision} onChange={e => setAllowRevision(e.target.checked)} />Guardar una rectificación y conservar el cierre anterior</label>}
            <button className="btn btn-primary full-width" disabled={busy || !cash || daily.loading || openingCents === null || Boolean(existingClose && !allowRevision)}>{busy ? 'Guardando…' : existingClose ? 'Guardar rectificación' : 'Guardar arqueo'}</button>
          </form>
        </section>
      </div>
      <div className="info-banner">Anticipos, fiado y crédito a favor se distinguen de las ventas netas. Comprar mercadería mueve inventario y, cuando se paga, caja; no vuelve a descontarse como gasto operativo.</div>
    </>}
    {expenseModal && <Modal title="Registrar gasto operativo" onClose={() => { if (!busy) setExpenseModal(false); }}><form onSubmit={addExpense}><div className="form-grid"><Field label="Fecha del gasto"><input type="date" name="date" defaultValue={localDate()} required /></Field><Field label="Categoría"><select name="category"><option>Publicidad</option><option>Alquiler</option><option>Servicios</option><option>Comisiones adicionales</option><option>Otros</option></select></Field></div><Field label="Descripción"><input name="description" placeholder="Ej. Campaña de Instagram" maxLength={160} required /></Field><div className="form-grid"><Field label="Importe (ARS)"><input name="amount" type="number" min="0.01" step="0.01" placeholder="0,00" required /></Field><Field label="Tipo de gasto"><select name="costType"><option value="variable">Variable</option><option value="fixed">Fijo</option></select></Field><Field label="Medio de pago"><select name="paymentMethod">{paidMethods.map(method => <option key={method}>{method}</option>)}</select></Field><Field label="Canal atribuible"><select name="channel"><option value="">Compartido entre canales</option>{CHANNELS.map(channel => <option key={channel}>{channel}</option>)}</select></Field></div><label className="report-checkbox"><input type="checkbox" name="paid" defaultChecked />Ya lo pagué: registrar también el egreso real</label><p className="accounting-note">Un gasto pendiente ya reduce la rentabilidad. Al registrar su pago más adelante, solo cambia caja. No repitas costos incluidos en una venta.</p><div className="form-actions"><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setExpenseModal(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar gasto'}</button></div></form></Modal>}
    {paying && <Modal title="Pagar gasto pendiente" onClose={() => { if (!busy) setPaying(null); }}><form onSubmit={pay}><p><strong>{paying.description}</strong><br />Importe: {money(paying.amount)}</p><div className="form-grid"><Field label="Fecha del pago real"><input type="date" name="date" defaultValue={localDate()} required /></Field><Field label="Medio de pago"><select name="method" defaultValue={paying.paymentMethod}>{paidMethods.map(method => <option key={method}>{method}</option>)}</select></Field></div><p className="accounting-note">El gasto ya está reconocido. Este pago no vuelve a descontarlo de la ganancia.</p><div className="form-actions"><button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setPaying(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Guardando…' : 'Confirmar pago'}</button></div></form></Modal>}
  </>;
}

function ReportError({ message, stale, retry }: { message: string; stale: boolean; retry: () => void }) {
  return <div className="info-banner report-error" role="alert"><AlertCircle size={17} /><span>{message}{stale && ' Se conserva el último informe recibido; puede estar desactualizado.'}</span><button className="btn btn-secondary btn-small" type="button" onClick={retry}><RefreshCw size={13} />Reintentar</button></div>;
}

function DailyRevenueChart({ rows, selected, onSelect }: { rows: { date: string; total_cents: number }[]; selected: string | null; onSelect: (date: string) => void }) {
  const width = 850, height = 190, padding = 16;
  const maximum = Math.max(0, ...rows.map(row => row.total_cents)), minimum = Math.min(0, ...rows.map(row => row.total_cents));
  const span = maximum - minimum || 1, usableHeight = height - padding * 2;
  const zeroY = padding + maximum / span * usableHeight, columnWidth = (width - padding * 2) / Math.max(rows.length, 1);
  return <div className="report-daily-chart"><svg viewBox={`0 0 ${width} ${height + 24}`} role="img" aria-label="Ingresos netos diarios, con devoluciones negativas"><line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="#d9cfc4" />{rows.map((row, index) => {
    const barHeight = Math.max(Math.abs(row.total_cents) / span * usableHeight, 1.5), barY = row.total_cents >= 0 ? zeroY - barHeight : zeroY;
    return <g key={row.date}><rect x={padding + index * columnWidth + 2} y={barY} width={Math.max(columnWidth - 5, 2)} height={barHeight} rx="3" fill={selected === row.date ? '#5c2035' : row.total_cents < 0 ? '#b37c64' : '#99465d'} role="button" tabIndex={0} aria-label={`${row.date}: ${money(row.total_cents)}`} onClick={() => onSelect(row.date)} onFocus={() => onSelect(row.date)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(row.date); } }}><title>{row.date}: {money(row.total_cents)}</title></rect>{(index === 0 || (index + 1) % 5 === 0 || index === rows.length - 1) && <text x={padding + index * columnWidth + columnWidth / 2} y={height + 17} textAnchor="middle" fill="#a08b77" fontSize="11">{row.date.slice(-2)}</text>}</g>;
  })}</svg></div>;
}
