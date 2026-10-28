import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Ban, Check, Copy, Eye, MessageCircle, PackageCheck, ReceiptText, Search, Undo2, Wallet } from 'lucide-react';
import { EmptyState, Field, Modal } from '../components/ui';
import { amountInput, cents, displayDate, localDate, localMonth, money } from '../domain/format';
import { completeSale, payDirectCosts, recordPayment, recordRefund, releaseSale, reserveSale, returnSale, voidSale } from '../domain/services';
import { PAYMENT_METHODS, type PaidMethod, type Sale, type SaleStatus, type Snapshot } from '../domain/types';

type Notify = (message: string, kind?: 'success' | 'error') => void;
type Props = { data: Snapshot; notify: Notify };
const PAID_METHODS = PAYMENT_METHODS.filter((method): method is PaidMethod => method !== 'Crédito');
const STATE_LABELS: Record<SaleStatus, string> = { pending: 'Pendiente', reserved: 'Reservado', completed: 'Completado', void: 'Cancelado' };
type PendingCommand = { signature: string; id: string };
function commandFor(ref: { current: PendingCommand | null }, payload: unknown) {
  const signature = JSON.stringify(payload);
  if (ref.current?.signature !== signature) ref.current = { signature, id: crypto.randomUUID() };
  return ref.current.id;
}

/** Money history survives cancellation: receipts minus actual refunds. */
export const salePaid = (data: Snapshot, saleId: string) => data.payments.filter(payment => payment.saleId === saleId)
  .reduce((sum, payment) => sum + (payment.kind === 'refund' ? -payment.amount : payment.amount), 0);
/** Server charges and return credits are authoritative; a negative balance is valid. */
export const saleBalance = (_data: Snapshot, sale: Sale) => sale.balance;

function errorText(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
function stateClass(status: SaleStatus) { return status === 'completed' ? 'badge-success' : status === 'reserved' ? 'badge-warning' : 'badge-neutral'; }
function paymentState(sale: Sale) {
  if (sale.balance < 0) return 'Crédito a favor';
  if (sale.balance === 0) return sale.status === 'void' ? 'Saldado' : 'Pagado';
  return sale.paid > 0 ? 'Cobro parcial' : 'Por cobrar';
}
function nameFor(sale: Sale, data: Snapshot) { return data.customers.find(customer => customer.id === sale.customerId)?.name || sale.customerName || 'Venta mostrador'; }
function balanceLabel(balance: number) { return balance < 0 ? `${money(-balance)} a favor` : balance > 0 ? `${money(balance)} pendiente` : 'Saldo cero'; }

export function saleReceipt(sale: Sale, customerName: string): string {
  const lines = ['Sou Linda System · COMPROBANTE INTERNO', sale.number, `Pedido: ${sale.date}`,
    ...(sale.completedDate ? [`Completado: ${sale.completedDate}`] : []),
    `Clienta: ${customerName}`, `Canal: ${sale.channel}`, `Estado: ${STATE_LABELS[sale.status]}`, ''];
  for (const item of sale.items) {
    lines.push(`${item.quantity} × ${item.productName} · ${item.variantLabel}`, `  ${money(item.netTotal)}`);
    if (item.returnedQuantity) lines.push(`  Unidades devueltas: ${item.returnedQuantity}`);
  }
  lines.push('', `Descuento incluido: ${money(sale.discount)}`, `TOTAL ORIGINAL: ${money(sale.total)}`);
  if (sale.returnedRevenue) lines.push(`Créditos por devoluciones: ${money(sale.returnedRevenue)}`);
  lines.push(balanceLabel(sale.balance), '', 'Comprobante interno · No válido como factura fiscal.');
  return lines.join('\n');
}

export function CollectPaymentModal({ sale, data, notify, onClose, refund = false }: {
  sale: Sale; data: Snapshot; notify: Notify; onClose: () => void; refund?: boolean;
}) {
  const balance = saleBalance(data, sale);
  const [mode, setMode] = useState<'receipt' | 'refund'>(refund ? 'refund' : 'receipt');
  const maximum = Math.max(0, mode === 'refund' ? -balance : balance);
  const [amount, setAmount] = useState(amountInput(maximum));
  const [method, setMethod] = useState<PaidMethod>('Efectivo');
  const [date, setDate] = useState(localDate());
  const [commission, setCommission] = useState(amountInput(sale.commissionRate));
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const command = useRef<PendingCommand | null>(null);
  const [confirmedRefund, setConfirmedRefund] = useState(false);
  function changeMode(next: 'receipt' | 'refund') {
    setMode(next); setAmount(amountInput(Math.max(0, next === 'refund' ? -balance : balance))); setConfirmedRefund(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      const value = cents(amount);
      if (value <= 0 || value > maximum) throw new Error('El importe debe ser positivo y no superar el saldo disponible.');
      if (mode === 'refund') {
        if (!confirmedRefund) throw new Error('Confirmá que devolviste realmente el dinero.');
        const id = commandFor(command, { mode, saleId: sale.id, value, method, date });
        await recordRefund(sale.id, value, method, date, id);
      } else {
        const rate = cents(commission);
        if (rate > 10_000) throw new Error('La comisión debe estar entre 0 y 100 %.');
        const id = commandFor(command, { mode, saleId: sale.id, value, method, date, rate });
        await recordPayment(sale.id, value, method, date, rate, id);
      }
      command.current = null;
      notify(mode === 'refund' ? 'Reembolso registrado. Los cobros originales se conservaron.' : 'Cobro registrado con su comisión y fecha reales.');
      onClose();
    } catch (error) { notify(errorText(error, 'No se pudo registrar el movimiento.'), 'error'); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <Modal title={`${mode === 'refund' ? 'Registrar reembolso' : 'Registrar cobro'} · ${sale.number}`} onClose={() => !saving && onClose()}>
    <form className="stack-form" onSubmit={submit}>
      <div className="segmented" aria-label="Tipo de movimiento de dinero">
        <button type="button" className={mode === 'receipt' ? 'active' : ''} disabled={saving || balance <= 0 || sale.status === 'void'} onClick={() => changeMode('receipt')}>Cobro</button>
        <button type="button" className={mode === 'refund' ? 'active' : ''} disabled={saving || balance >= 0} onClick={() => changeMode('refund')}>Reembolso</button>
      </div>
      <div className="payment-balance"><span className="muted">{mode === 'refund' ? 'Crédito a favor disponible' : 'Saldo pendiente del pedido'}</span><strong>{money(maximum)}</strong></div>
      <Field label={mode === 'refund' ? 'Importe a reembolsar (ARS)' : 'Importe a cobrar (ARS)'} hint="Ingresá un movimiento real de dinero; se admiten importes parciales."><input required autoFocus inputMode="decimal" type="number" min="0.01" step="0.01" max={amountInput(maximum)} value={amount} disabled={saving} onChange={event => setAmount(event.target.value)} /></Field>
      <div className="form-grid">
        <Field label="Medio de pago real"><select value={method} disabled={saving} onChange={event => setMethod(event.target.value as PaidMethod)}>{PAID_METHODS.map(value => <option key={value}>{value}</option>)}</select></Field>
        <Field label="Fecha del movimiento"><input required type="date" min={sale.date} value={date} disabled={saving} onChange={event => setDate(event.target.value)} /></Field>
      </div>
      {mode === 'receipt' && <Field label="Comisión de este cobro (%)" hint="Se aplica al importe cobrado, posterior al descuento."><input required inputMode="decimal" type="number" min="0" max="100" step="0.01" value={commission} disabled={saving} onChange={event => setCommission(event.target.value)} /></Field>}
      {mode === 'refund' ? <><p className="inline-note">El reembolso no cancela ventas ni devuelve prendas al stock. Las comisiones originales permanecen registradas.</p><label className="stock-filter"><input type="checkbox" checked={confirmedRefund} disabled={saving} onChange={event => setConfirmedRefund(event.target.checked)} />Confirmo que devolví este dinero a la clienta.</label></>
        : <p className="inline-note">El cobro actualiza caja en esta fecha. Si el pedido no se completó, será un anticipo: no reconoce una nueva venta ni descuenta stock.</p>}
      <div className="form-actions"><button className="btn btn-secondary" type="button" disabled={saving} onClick={onClose}>Volver</button><button className="btn btn-primary" disabled={saving || maximum <= 0 || (mode === 'refund' && !confirmedRefund)}>{saving ? 'Registrando…' : mode === 'refund' ? 'Confirmar reembolso' : 'Registrar cobro'}</button></div>
    </form>
  </Modal>;
}

function ReturnModal({ sale, notify, onClose }: { sale: Sale; notify: Notify; onClose: () => void }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [date, setDate] = useState(localDate());
  const [received, setReceived] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const command = useRef<PendingCommand | null>(null);
  const selectedCount = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const unknownCost = sale.items.some(item => item.costTotal === null && item.quantity > item.returnedQuantity);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      if (!received || selectedCount <= 0) throw new Error('Seleccioná las unidades recibidas y confirmá su recepción física.');
      const items = Object.fromEntries(Object.entries(quantities).filter(([, quantity]) => quantity > 0));
      for (const [id, quantity] of Object.entries(items)) {
        const line = sale.items.find(item => item.id === id);
        if (!line || !Number.isInteger(quantity) || quantity < 1 || quantity > line.quantity - line.returnedQuantity) throw new Error('Revisá las cantidades recibidas.');
        if (line.costTotal === null) throw new Error('Esa línea necesita un costo histórico conocido antes de reincorporarse al stock.');
      }
      await returnSale(sale.id, items, date, commandFor(command, { saleId: sale.id, items, date }));
      command.current = null;
      notify('Devolución registrada al costo histórico. El reembolso de dinero se registra por separado.');
      onClose();
    } catch (error) { notify(errorText(error, 'No se pudo registrar la devolución.'), 'error'); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <Modal title={`Devolver prendas · ${sale.number}`} onClose={() => !saving && onClose()} wide><form onSubmit={submit}>
    <p className="inline-note">Elegí únicamente prendas que recibiste físicamente. Se registran el crédito comercial y el costo histórico devuelto; no se devuelve dinero automáticamente.</p>
    {unknownCost && <p className="info-banner">Hay líneas sin costo histórico. Podés devolver las líneas con costo conocido; las otras requieren conciliación antes de reingresar al stock.</p>}
    <div className="table-wrap"><table><thead><tr><th>Prenda</th><th>Vendidas</th><th>Ya devueltas</th><th>Recibidas ahora</th></tr></thead><tbody>{sale.items.map(item => {
      const remaining = item.quantity - item.returnedQuantity;
      return <tr key={item.id}><td><strong>{item.productName}</strong><small className="muted">{item.variantLabel}</small>{item.costTotal === null && <small className="danger-text">Costo histórico pendiente</small>}</td><td>{item.quantity}</td><td>{item.returnedQuantity}</td><td><input type="number" aria-label={`Devolver ${item.productName} ${item.variantLabel}`} min="0" max={remaining} step="1" value={quantities[item.id] ?? 0} disabled={saving || remaining <= 0 || item.costTotal === null} onChange={event => setQuantities(current => ({ ...current, [item.id]: Number(event.target.value) }))} /></td></tr>;
    })}</tbody></table></div>
    <Field label="Fecha de recepción"><input required type="date" min={sale.completedDate || sale.date} value={date} disabled={saving} onChange={event => setDate(event.target.value)} /></Field>
    <label className="stock-filter"><input type="checkbox" checked={received} disabled={saving} onChange={event => setReceived(event.target.checked)} />Confirmo que recibí físicamente estas prendas y pueden volver al inventario.</label>
    <div className="form-actions"><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>Volver</button><button className="btn btn-primary" disabled={saving || !received || selectedCount <= 0}>{saving ? 'Registrando…' : `Registrar ${selectedCount} ${selectedCount === 1 ? 'unidad' : 'unidades'}`}</button></div>
  </form></Modal>;
}

function DirectCostsModal({ sale, notify, onClose }: { sale: Sale; notify: Notify; onClose: () => void }) {
  const [method, setMethod] = useState<PaidMethod>(sale.directCostMethod);
  const [date, setDate] = useState(localDate());
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const command = useRef<PendingCommand | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      if (!confirmed) throw new Error('Confirmá que realizaste el pago.');
      await payDirectCosts(sale.id, method, date, commandFor(command, { saleId: sale.id, method, date }));
      command.current = null;
      notify('Envío y packaging pagados. Se registró el egreso sin duplicar el gasto.'); onClose();
    } catch (error) { notify(errorText(error, 'No se pudo registrar el pago.'), 'error'); }
    finally { submitting.current = false; setSaving(false); }
  }
  return <Modal title={`Pagar costos pendientes · ${sale.number}`} onClose={() => !saving && onClose()}><form onSubmit={submit}>
    <div className="payment-balance"><span>Envío y packaging</span><strong>{money(sale.shippingCost + sale.packagingCost)}</strong></div>
    <p className="inline-note">Estos gastos ya se reconocieron al completar la venta. Esta acción registra únicamente la salida efectiva de dinero.</p>
    <Field label="Medio de pago real"><select disabled={saving} value={method} onChange={event => setMethod(event.target.value as PaidMethod)}>{PAID_METHODS.map(value => <option key={value}>{value}</option>)}</select></Field>
    <Field label="Fecha del pago"><input required type="date" min={sale.completedDate || sale.date} value={date} disabled={saving} onChange={event => setDate(event.target.value)} /></Field>
    <label className="stock-filter"><input type="checkbox" checked={confirmed} disabled={saving} onChange={event => setConfirmed(event.target.checked)} />Confirmo que estos costos ya fueron pagados.</label>
    <div className="form-actions"><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>Volver</button><button className="btn btn-primary" disabled={saving || !confirmed}>{saving ? 'Registrando…' : 'Confirmar pago'}</button></div>
  </form></Modal>;
}

type Confirmation = { id: string; kind: 'complete' | 'release' | 'cancel' };

export default function SalesPage({ data, notify }: Props) {
  const [month, setMonth] = useState(localMonth());
  const [allDates, setAllDates] = useState(false);
  const [status, setStatus] = useState<SaleStatus | ''>('');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [moneyAction, setMoneyAction] = useState<{ id: string; refund: boolean } | null>(null);
  const [returnId, setReturnId] = useState<string | null>(null);
  const [costsId, setCostsId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [physicalReturn, setPhysicalReturn] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const customers = useMemo(() => new Map(data.customers.map(customer => [customer.id, customer])), [data.customers]);
  const filtered = data.sales.filter(sale => (allDates || sale.date.startsWith(month)) && (!status || sale.status === status)
    && `${sale.number} ${nameFor(sale, data)} ${sale.channel} ${sale.items.map(item => `${item.productName} ${item.variantLabel}`).join(' ')}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')))
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const detail = data.sales.find(sale => sale.id === detailId);
  const moneySale = data.sales.find(sale => sale.id === moneyAction?.id);
  const returning = data.sales.find(sale => sale.id === returnId);
  const payingCosts = data.sales.find(sale => sale.id === costsId);
  const confirming = data.sales.find(sale => sale.id === confirmation?.id);
  const detailPayments = detail ? data.payments.filter(payment => payment.saleId === detail.id).sort((a, b) => b.date.localeCompare(a.date)) : [];
  const originalGrossProfit = detail?.costTotal == null ? null : detail.total - detail.costTotal;
  const originalContribution = originalGrossProfit === null || !detail ? null : originalGrossProfit - detail.commissionCost - detail.shippingCost - detail.packagingCost;
  const hiddenDetail = Boolean(moneySale || returning || payingCosts || confirming);

  function confirm(sale: Sale, kind: Confirmation['kind']) { setPhysicalReturn(false); setConfirmation({ id: sale.id, kind }); }
  async function reserve(sale: Sale) {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try { await reserveSale(sale.id); notify('Pedido reservado. Las unidades quedaron apartadas sin registrar venta ni CMV.'); }
    catch (error) { notify(errorText(error, 'No se pudo reservar el pedido.'), 'error'); }
    finally { submitting.current = false; setSaving(false); }
  }
  async function confirmOperation() {
    if (!confirmation || !confirming || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      if (confirmation.kind === 'complete') { await completeSale(confirming.id); notify('Pedido completado. Se registraron la salida física y sus costos históricos.'); }
      else if (confirmation.kind === 'release') { await releaseSale(confirming.id); notify('Reserva liberada. El pedido sigue pendiente.'); }
      else {
        if (confirming.status === 'completed' && !physicalReturn) throw new Error('Confirmá la recepción física de todas las unidades pendientes.');
        await voidSale(confirming.id, confirming.status === 'completed');
        notify(confirming.status === 'completed' ? 'Devolución total registrada. Los cobros y comisiones se conservaron.' : 'Pedido cancelado. Sus reservas quedaron liberadas.');
      }
      setConfirmation(null);
    } catch (error) { notify(errorText(error, 'No se pudo completar la operación.'), 'error'); }
    finally { submitting.current = false; setSaving(false); }
  }
  async function copyReceipt(sale: Sale) {
    try { await navigator.clipboard.writeText(saleReceipt(sale, nameFor(sale, data))); notify('Comprobante copiado. Es un recibo interno, no una factura fiscal.'); }
    catch { notify('El navegador no permitió copiar. Podés seleccionar el texto del comprobante o prepararlo en WhatsApp.', 'error'); }
  }
  function whatsappUrl(sale: Sale) {
    const phone = customers.get(sale.customerId || '')?.phone.replace(/\D/g, '') || '';
    return `https://wa.me/${phone.length >= 8 ? phone : ''}?text=${encodeURIComponent(saleReceipt(sale, nameFor(sale, data)))}`;
  }

  return <div className="sales-page">
    <div className="page-heading"><div><p className="eyebrow">CADA PEDIDO, UNA HISTORIA</p><h1>Pedidos y cobros<span className="heading-dot">.</span></h1><p className="page-subtitle">Apartá prendas, confirmá entregas y registrá el dinero real de cada operación.</p></div><span className="badge badge-neutral"><ReceiptText size={15} /> {filtered.length} pedidos visibles</span></div>
    <div className="inventory-overview">
      <div className="mini-stat"><span className="muted">Con entrega confirmada</span><strong>{filtered.filter(sale => sale.completedDate).length}</strong></div>
      <div className="mini-stat"><span className="muted">Reservados</span><strong>{filtered.filter(sale => sale.status === 'reserved').length}</strong></div>
      <div className="mini-stat"><span className="muted">Saldo de pedidos por cobrar</span><strong>{money(filtered.reduce((sum, sale) => sum + Math.max(0, sale.balance), 0))}</strong></div>
      <div className="mini-stat"><span className="muted">Crédito a favor de clientas</span><strong>{money(filtered.reduce((sum, sale) => sum + Math.max(0, -sale.balance), 0))}</strong></div>
    </div>
    <section className="panel"><div className="panel-head toolbar">
      <label className="search-box"><Search size={18} /><input className="search-input" placeholder="Buscar clienta, pedido o modelo…" aria-label="Buscar pedidos" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <Field label="Mes del pedido"><input type="month" required disabled={allDates} value={month} onChange={event => setMonth(event.target.value || localMonth())} /></Field>
      <Field label="Estado comercial"><select value={status} onChange={event => setStatus(event.target.value as SaleStatus | '')}><option value="">Todos los estados</option>{Object.entries(STATE_LABELS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></Field>
      <label className="stock-filter"><input type="checkbox" checked={allDates} onChange={event => setAllDates(event.target.checked)} />Todo el historial</label>
    </div>
      {filtered.length ? <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Clienta / canal</th><th>Total original</th><th>Estado comercial</th><th>Cobranza</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{filtered.map(sale => <tr key={sale.id} className={sale.status === 'void' ? 'void-sale' : ''}>
        <td><strong className="mono">{sale.number}</strong><small className="muted">{displayDate(sale.date)} · {sale.items.reduce((sum, item) => sum + item.quantity, 0)} prendas</small></td>
        <td><strong>{nameFor(sale, data)}</strong><small className="muted">{sale.channel} · {sale.paymentMethod === 'Crédito' ? 'Fiado / crédito' : sale.paymentMethod}</small></td>
        <td><strong>{money(sale.total)}</strong>{sale.returnedRevenue > 0 && <small className="muted">Devuelto: {money(sale.returnedRevenue)}</small>}</td>
        <td><span className={`badge ${stateClass(sale.status)}`}>{STATE_LABELS[sale.status]}</span>{sale.completedDate && <small className="muted">Entrega: {displayDate(sale.completedDate)}</small>}</td>
        <td><span className={`badge ${sale.balance > 0 ? 'badge-warning' : sale.balance < 0 ? 'badge-neutral' : 'badge-success'}`}>{paymentState(sale)}</span>{sale.balance !== 0 && <small>{money(Math.abs(sale.balance))}</small>}</td>
        <td><div className="row-actions"><button className="icon-btn" aria-label={`Ver detalle ${sale.number}`} onClick={() => setDetailId(sale.id)}><Eye size={17} /></button>{sale.balance > 0 && sale.status !== 'void' && <button className="btn btn-ghost btn-small" onClick={() => setMoneyAction({ id: sale.id, refund: false })}><ArrowDownLeft size={15} />Cobrar</button>}{sale.balance < 0 && <button className="btn btn-ghost btn-small" onClick={() => setMoneyAction({ id: sale.id, refund: true })}><ArrowUpRight size={15} />Reembolsar</button>}</div></td>
      </tr>)}</tbody></table></div> : <EmptyState title="No hay pedidos con estos filtros" detail="Elegí otro mes, activá todo el historial o registrá un pedido desde el punto de venta." />}
      <div className="table-footer"><span>{filtered.length} operaciones</span><span>El estado del pedido y su saldo se conservan por separado.</span></div>
    </section>

    {detail && !hiddenDetail && <Modal title={`Detalle · ${detail.number}`} onClose={() => !saving && setDetailId(null)} wide>
      <div className="sale-detail-meta"><div><span className="muted">Clienta</span><strong>{nameFor(detail, data)}</strong></div><div><span className="muted">Pedido / entrega</span><strong>{displayDate(detail.date)}{detail.completedDate ? ` / ${displayDate(detail.completedDate)}` : ' / pendiente'}</strong></div><div><span className="muted">Canal</span><strong>{detail.channel}</strong></div><div><span className="muted">Estado</span><strong>{STATE_LABELS[detail.status]} · {paymentState(detail)}</strong></div></div>
      <div className="table-wrap"><table><thead><tr><th>Prenda</th><th>Cant.</th><th>Precio unit.</th><th>Descuento</th><th>Venta neta</th><th>CMV histórico</th><th>Devueltas</th></tr></thead><tbody>{detail.items.map(item => <tr key={item.id}><td><strong>{item.productName}</strong><small className="muted">{item.variantLabel}</small></td><td>{item.quantity}</td><td>{money(item.unitPrice)}</td><td>{money(item.discount)}</td><td>{money(item.netTotal)}</td><td>{item.costTotal === null ? detail.completedDate ? 'Costo desconocido' : 'Al completar' : money(item.costTotal)}</td><td>{item.returnedQuantity} / {item.quantity}</td></tr>)}</tbody></table></div>
      <div className="detail-totals">
        <div><span>Descuento del pedido</span><strong>{money(detail.discount)}{detail.discountKind === 'percent' ? ` (${amountInput(detail.discountValue)} %)` : ''}</strong></div>
        <div><span>Venta neta original</span><strong>{money(detail.total)}</strong></div>
        <div><span>CMV original</span><strong>{detail.costTotal === null ? detail.completedDate ? 'Sin costo histórico conocido' : 'Se fija al completar' : money(detail.costTotal)}</strong></div>
        <div><span>Ganancia bruta original</span><strong>{originalGrossProfit === null ? 'Pendiente de costo' : money(originalGrossProfit)}</strong></div>
        <div><span>Comisiones efectivamente registradas</span><strong>{money(detail.commissionCost)}</strong></div>
        <div><span>Envío / packaging</span><strong>{money(detail.shippingCost)} / {money(detail.packagingCost)}</strong></div>
        <div><span>Pago de envío / packaging</span><strong>{detail.directCostsPaid ? `Pagados · ${detail.directCostMethod}` : 'Pendientes de pago'}</strong></div>
        <div className="contribution"><span>Margen sobre venta original, antes de devoluciones</span><strong>{originalContribution === null ? 'Pendiente de costo' : money(originalContribution)}</strong></div>
        <div><span>Créditos por devoluciones</span><strong>{money(detail.returnedRevenue)}</strong></div>
        <div><span>Cobros netos de reembolsos</span><strong>{money(salePaid(data, detail.id))}</strong></div>
        <div className="checkout-total"><span>{detail.balance < 0 ? 'Crédito a favor de la clienta' : 'Saldo del pedido'}</span><strong>{money(Math.abs(detail.balance))}</strong></div>
      </div>
      {detail.returnedRevenue > 0 && <p className="inline-note">El cuadro conserva los importes originales. Las compensaciones por devolución y sus costos históricos se reflejan por fecha en Finanzas; el período de venta no se borra.</p>}
      {!detail.completedDate && <p className="inline-note">Este pedido todavía no es una venta completada. Las reservas reducen disponibilidad, y los cobros previos son anticipos.</p>}
      <div className="section-title"><h3>Historial de dinero real</h3><span className="muted">{detailPayments.length} registros</span></div>
      {detailPayments.length ? <div className="payment-history">{detailPayments.map(payment => <div key={payment.id}><span>{displayDate(payment.date)} · {payment.kind === 'refund' ? 'Reembolso' : 'Cobro'} · {payment.method}{payment.commission > 0 ? ` · comisión ${money(payment.commission)}` : ''}</span><strong>{payment.kind === 'refund' ? '−' : '+'}{money(payment.amount)}</strong></div>)}</div> : <p className="muted">Todavía no se registraron cobros ni reembolsos.</p>}
      <div className="form-actions sales-lifecycle-actions">
        {detail.status === 'pending' && <button className="btn btn-secondary" disabled={saving} onClick={() => reserve(detail)}><PackageCheck size={16} />Reservar</button>}
        {detail.status === 'reserved' && <button className="btn btn-secondary" disabled={saving} onClick={() => confirm(detail, 'release')}>Liberar reserva</button>}
        {(detail.status === 'pending' || detail.status === 'reserved') && <button className="btn btn-primary" disabled={saving} onClick={() => confirm(detail, 'complete')}><Check size={16} />Completar pedido</button>}
        {detail.balance > 0 && detail.status !== 'void' && <button className="btn btn-primary" disabled={saving} onClick={() => setMoneyAction({ id: detail.id, refund: false })}><ArrowDownLeft size={16} />Registrar cobro</button>}
        {detail.balance < 0 && <button className="btn btn-secondary" disabled={saving} onClick={() => setMoneyAction({ id: detail.id, refund: true })}><ArrowUpRight size={16} />Registrar reembolso</button>}
        {detail.status === 'completed' && detail.items.some(item => item.quantity > item.returnedQuantity) && <button className="btn btn-secondary" disabled={saving} onClick={() => setReturnId(detail.id)}><Undo2 size={16} />Devolver prendas</button>}
        {detail.completedDate && !detail.directCostsPaid && detail.shippingCost + detail.packagingCost > 0 && <button className="btn btn-secondary" disabled={saving} onClick={() => setCostsId(detail.id)}><Wallet size={16} />Pagar envío / packaging</button>}
        {detail.status !== 'void' && <button className="btn btn-ghost danger-text" disabled={saving} onClick={() => confirm(detail, 'cancel')}><Ban size={16} />Cancelar pedido</button>}
      </div>
      <div className="section-title"><h3>Comprobante interno</h3></div><textarea className="receipt-preview" aria-label="Texto del comprobante interno" readOnly value={saleReceipt(detail, nameFor(detail, data))} />
      <div className="form-actions"><button className="btn btn-secondary" onClick={() => copyReceipt(detail)}><Copy size={16} />Copiar comprobante</button><a className="btn btn-secondary" href={whatsappUrl(detail)} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} />Preparar WhatsApp</a></div>
    </Modal>}

    {moneySale && moneyAction && <CollectPaymentModal key={`${moneySale.id}-${moneyAction.refund}`} sale={moneySale} data={data} refund={moneyAction.refund} notify={notify} onClose={() => setMoneyAction(null)} />}
    {returning && <ReturnModal sale={returning} notify={notify} onClose={() => setReturnId(null)} />}
    {payingCosts && <DirectCostsModal sale={payingCosts} notify={notify} onClose={() => setCostsId(null)} />}
    {confirming && confirmation && <Modal title={confirmation.kind === 'complete' ? 'Confirmar entrega y venta' : confirmation.kind === 'release' ? 'Liberar reserva' : 'Cancelar pedido'} onClose={() => !saving && setConfirmation(null)}>
      <div className="confirmation-copy"><p>Pedido <strong>{confirming.number}</strong> por <strong>{money(confirming.total)}</strong>.</p>
        {confirmation.kind === 'complete' ? <><p>Se confirmará la salida física, se consumirá la reserva propia y se guardará el CMV calculado con el CPP actual.</p><p className="inline-note">{confirming.paymentMethod === 'Crédito' ? 'La entrega quedará fiada; esta acción no inventa un cobro.' : 'Como es un pedido de pago inmediato, también se registrará su cobro pendiente. Confirmá únicamente si ese dinero ya fue recibido.'}</p></>
          : confirmation.kind === 'release' ? <p>Las unidades quedarán disponibles para otras ventas. El pedido continuará pendiente y conservará sus anticipos.</p>
            : confirming.status === 'completed' ? <><p>Esta cancelación requiere la devolución física de todas las unidades todavía no devueltas. Se repondrán a su costo histórico y se registrará el crédito comercial en la fecha actual.</p><label className="stock-filter"><input type="checkbox" checked={physicalReturn} disabled={saving} onChange={event => setPhysicalReturn(event.target.checked)} />Confirmo que recibí físicamente TODAS las prendas pendientes de devolución.</label><p className="inline-note">No se borra la venta original ni se reintegra dinero automáticamente. Los cobros y comisiones se conservan; si corresponde, registrá el reembolso por separado.</p></>
              : <><p>Se liberarán las reservas de este pedido y se conservará su historial.</p><p className="inline-note">Si hubo anticipos, quedarán como crédito a favor de la clienta. El reembolso debe registrarse cuando ocurra.</p></>}
      </div>
      <div className="form-actions"><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setConfirmation(null)}>Volver</button><button className={`btn ${confirmation.kind === 'cancel' ? 'btn-danger' : 'btn-primary'}`} disabled={saving || (confirmation.kind === 'cancel' && confirming.status === 'completed' && !physicalReturn)} onClick={confirmOperation}>{saving ? 'Registrando…' : confirmation.kind === 'complete' ? 'Confirmar entrega' : confirmation.kind === 'release' ? 'Liberar reserva' : 'Confirmar cancelación'}</button></div>
    </Modal>}
  </div>;
}
