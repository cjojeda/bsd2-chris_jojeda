import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Eye, MessageCircle, Pencil, Plus, Search, Users } from 'lucide-react';
import { EmptyState, Field, Modal } from '../components/ui';
import { displayDate, money, whatsappPhone } from '../domain/format';
import { saveCustomer } from '../domain/services';
import type { Customer, Sale, SaleStatus, Snapshot } from '../domain/types';
import { CollectPaymentModal, saleBalance } from './SalesPage';

type Props = { data: Snapshot; notify: (message: string, kind?: 'success' | 'error') => void };
type CustomerForm = Omit<Customer, 'id' | 'createdAt'> & { id?: string };
const STATE_LABELS: Record<SaleStatus, string> = { pending: 'Pendiente', reserved: 'Reservado', completed: 'Completado', void: 'Cancelado' };
function customerInitials(name: string) { return name.trim().split(/\s+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toLocaleUpperCase('es'); }
function balanceText(value: number) { return value < 0 ? `${money(-value)} a favor` : value > 0 ? `${money(value)} por cobrar` : 'Saldo cero'; }

export default function CustomersPage({ data, notify }: Props) {
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<CustomerForm | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [moneyAction, setMoneyAction] = useState<{ id: string; refund: boolean } | null>(null);
  const stats = useMemo(() => new Map(data.customers.map(customer => {
    // Every state belongs in history: a cancelled order can still owe a refund.
    const orders = data.sales.filter(sale => sale.customerId === customer.id);
    const delivered = orders.filter(sale => Boolean(sale.completedDate));
    return [customer.id, {
      orders, count: delivered.length,
      netPurchases: delivered.reduce((sum, sale) => sum + sale.total - sale.returnedRevenue, 0),
      debt: orders.reduce((sum, sale) => sum + Math.max(0, saleBalance(data, sale)), 0),
      credit: orders.reduce((sum, sale) => sum + Math.max(0, -saleBalance(data, sale)), 0),
    }];
  })), [data]);
  const filtered = data.customers.filter(customer => `${customer.name} ${customer.phone} ${customer.social} ${customer.preferredSize}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'))).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const historyCustomer = data.customers.find(customer => customer.id === historyId);
  const historyStats = historyId ? stats.get(historyId) : undefined;
  const collecting = data.sales.find(sale => sale.id === moneyAction?.id);
  const historySales = [...(historyStats?.orders ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const historyIds = new Set(historySales.map(sale => sale.id));
  const historyPayments = data.payments.filter(payment => historyIds.has(payment.saleId)).sort((a, b) => b.date.localeCompare(a.date));

  function openForm(customer?: Customer) {
    setForm(customer ? { id: customer.id, name: customer.name, phone: customer.phone, social: customer.social, preferredSize: customer.preferredSize } : { name: '', phone: '', social: '', preferredSize: '' });
  }
  function update(key: keyof CustomerForm, value: string) { setForm(current => current && ({ ...current, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      if (!form.name.trim()) throw new Error('Ingresá el nombre de la clienta.');
      await saveCustomer(form);
      notify(form.id ? 'Datos de la clienta actualizados en la base local.' : 'Clienta agregada a tu agenda local.');
      setForm(null);
    } catch (error) { notify(error instanceof Error ? error.message : 'No se pudo guardar la clienta.', 'error'); }
    finally { submitting.current = false; setSaving(false); }
  }
  function moneyButton(sale: Sale) {
    const balance = saleBalance(data, sale);
    if (balance > 0 && sale.status !== 'void') return <button className="btn btn-ghost btn-small" onClick={() => setMoneyAction({ id: sale.id, refund: false })}><ArrowDownLeft size={14} />Cobrar</button>;
    if (balance < 0) return <button className="btn btn-ghost btn-small" onClick={() => setMoneyAction({ id: sale.id, refund: true })}><ArrowUpRight size={14} />Reembolsar</button>;
    return null;
  }
  function whatsapp(customer: Customer) {
    const phone = whatsappPhone(customer.phone);
    return `https://wa.me/${phone}?text=${encodeURIComponent(`Hola ${customer.name}, ¿cómo estás?`)}`;
  }

  return <div className="customers-page">
    <div className="page-heading"><div><p className="eyebrow">CERCA DE QUIENES TE ELIGEN</p><h1>Tus clientas<span className="heading-dot">.</span></h1><p className="page-subtitle">Sus talles, sus compras y sus saldos, sin perder la historia.</p></div><button className="btn btn-primary" onClick={() => openForm()}><Plus size={18} />Nueva clienta</button></div>
    <div className="inventory-overview">
      <div className="mini-stat"><span className="muted">Clientas registradas</span><strong>{data.customers.length}</strong></div>
      <div className="mini-stat"><span className="muted">Con compras completadas</span><strong>{[...stats.values()].filter(stat => stat.count > 0).length}</strong></div>
      <div className="mini-stat"><span className="muted">Saldos de pedidos por cobrar</span><strong>{money([...stats.values()].reduce((sum, stat) => sum + stat.debt, 0))}</strong></div>
      <div className="mini-stat"><span className="muted">Créditos a favor</span><strong>{money([...stats.values()].reduce((sum, stat) => sum + stat.credit, 0))}</strong></div>
    </div>
    <section className="panel">
      <div className="panel-head toolbar"><label className="search-box"><Search size={18} /><input className="search-input" aria-label="Buscar clientas" placeholder="Buscar por nombre, teléfono, red social o talle…" value={search} onChange={event => setSearch(event.target.value)} /></label><span className="muted"><Users size={15} /> {filtered.length} clientas</span></div>
      {filtered.length ? <div className="table-wrap"><table><thead><tr><th>Clienta</th><th>Contacto</th><th>Talles preferidos</th><th>Compras netas</th><th>Por cobrar</th><th>A favor</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{filtered.map(customer => {
        const stat = stats.get(customer.id)!;
        return <tr key={customer.id}>
          <td><div className="customer-cell"><span className="customer-avatar">{customerInitials(customer.name)}</span><strong>{customer.name}</strong></div></td>
          <td><span>{customer.phone || 'Sin teléfono'}</span><small className="muted">{customer.social || 'Sin red social'}</small></td>
          <td><span className="badge badge-neutral">{customer.preferredSize || 'Sin registrar'}</span></td>
          <td><strong>{money(stat.netPurchases)}</strong><small className="muted">{stat.count} entregas · devoluciones descontadas</small></td>
          <td>{stat.debt > 0 ? <span className="badge badge-warning">{money(stat.debt)}</span> : <span className="muted">—</span>}</td>
          <td>{stat.credit > 0 ? <span className="badge badge-neutral">{money(stat.credit)}</span> : <span className="muted">—</span>}</td>
          <td><div className="row-actions"><button className="icon-btn" aria-label={`Ver historial de ${customer.name}`} onClick={() => setHistoryId(customer.id)}><Eye size={17} /></button><button className="icon-btn" aria-label={`Editar ${customer.name}`} onClick={() => openForm(customer)}><Pencil size={16} /></button>{whatsappPhone(customer.phone).length >= 8 && <a className="icon-btn" href={whatsapp(customer)} target="_blank" rel="noopener noreferrer" aria-label={`Preparar WhatsApp de ${customer.name}`}><MessageCircle size={17} /></a>}</div></td>
        </tr>;
      })}</tbody></table></div> : <EmptyState title={data.customers.length ? 'No encontramos esa clienta' : 'Una agenda que conoce a tus clientas'} detail={data.customers.length ? 'Buscá por otro nombre, teléfono, usuario o talle.' : 'Guardá contactos y preferencias. Sus pedidos se vinculan al seleccionarlas en el punto de venta.'} action={!data.customers.length && <button className="btn btn-primary" onClick={() => openForm()}><Plus size={17} />Agregar clienta</button>} />}
      <div className="table-footer"><span>Los saldos y créditos se muestran separados; no se compensan entre pedidos automáticamente.</span><span>WhatsApp abre un mensaje para revisar y enviar.</span></div>
    </section>

    {form && <Modal title={form.id ? 'Editar clienta' : 'Nueva clienta'} onClose={() => !saving && setForm(null)}>
      <form className="stack-form" onSubmit={submit}>
        <Field label="Nombre y apellido"><input required autoFocus maxLength={120} value={form.name} disabled={saving} onChange={event => update('name', event.target.value)} placeholder="María Rodríguez" /></Field>
        <Field label="Teléfono / WhatsApp" hint="Usá un número paraguayo como 0981 123456 o +595 981 123456. El enlace no envía mensajes automáticamente."><input type="tel" maxLength={40} value={form.phone} disabled={saving} onChange={event => update('phone', event.target.value)} placeholder="+595 981 123456" /></Field>
        <div className="form-grid"><Field label="Red social / usuario"><input maxLength={100} value={form.social} disabled={saving} onChange={event => update('social', event.target.value)} placeholder="Instagram @maria" /></Field><Field label="Talles preferidos"><input maxLength={120} value={form.preferredSize} disabled={saving} onChange={event => update('preferredSize', event.target.value)} placeholder="95, 100 / M" /></Field></div>
        <p className="inline-note">Estos datos se guardan en la base SQLite de tu notebook.</p>
        <div className="form-actions"><button className="btn btn-secondary" type="button" disabled={saving} onClick={() => setForm(null)}>Volver</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar clienta'}</button></div>
      </form>
    </Modal>}

    {historyCustomer && !collecting && <Modal title={`Historial · ${historyCustomer.name}`} onClose={() => setHistoryId(null)} wide>
      <div className="customer-profile"><span className="customer-avatar large">{customerInitials(historyCustomer.name)}</span><div><h3>{historyCustomer.name}</h3><p className="muted">{historyCustomer.phone || 'Sin teléfono'}{historyCustomer.social ? ` · ${historyCustomer.social}` : ''}</p><span className="badge badge-neutral">Talles preferidos: {historyCustomer.preferredSize || 'Sin registrar'}</span></div></div>
      <div className="customer-summary"><div><span className="muted">Entregas completadas</span><strong>{historyStats?.count ?? 0}</strong></div><div><span className="muted">Comprado tras devoluciones</span><strong>{money(historyStats?.netPurchases ?? 0)}</strong></div><div><span className="muted">Por cobrar</span><strong>{money(historyStats?.debt ?? 0)}</strong></div><div><span className="muted">Crédito a favor</span><strong>{money(historyStats?.credit ?? 0)}</strong></div></div>
      <div className="section-title"><h3>Todos sus pedidos</h3><span className="muted">Incluye pendientes, reservas y cancelaciones.</span></div>
      {historySales.length ? <div className="table-wrap"><table><thead><tr><th>Pedido / fecha</th><th>Prendas</th><th>Estado</th><th>Total original</th><th>Saldo firmado</th></tr></thead><tbody>{historySales.map(sale => <tr key={sale.id}>
        <td><strong className="mono">{sale.number}</strong><small className="muted">{displayDate(sale.date)}</small>{sale.completedDate && <small className="muted">Entrega: {displayDate(sale.completedDate)}</small>}</td>
        <td>{sale.items.map(item => <small key={item.id}>{item.quantity} × {item.productName} · {item.variantLabel}{item.returnedQuantity > 0 ? ` · devueltas ${item.returnedQuantity}` : ''}</small>)}</td>
        <td><span className={`badge ${sale.status === 'completed' ? 'badge-success' : sale.status === 'reserved' ? 'badge-warning' : 'badge-neutral'}`}>{STATE_LABELS[sale.status]}</span></td>
        <td>{money(sale.total)}{sale.returnedRevenue > 0 && <small className="muted">Devuelto: {money(sale.returnedRevenue)}</small>}</td>
        <td><strong className={sale.balance < 0 ? 'positive-text' : sale.balance > 0 ? 'danger-text' : 'muted'}>{balanceText(sale.balance)}</strong>{moneyButton(sale)}</td>
      </tr>)}</tbody></table></div> : <p className="muted">Todavía no hay pedidos vinculados a esta clienta.</p>}
      <div className="section-title"><h3>Cobros y reembolsos</h3><span className="muted">{historyPayments.length} registros conservados</span></div>
      {historyPayments.length ? <div className="payment-history">{historyPayments.map(payment => <div key={payment.id}><span>{displayDate(payment.date)} · {payment.kind === 'refund' ? 'Reembolso' : 'Cobro'} · {payment.method}{payment.commission > 0 ? ` · comisión ${money(payment.commission)}` : ''}</span><strong>{payment.kind === 'refund' ? '−' : '+'}{money(payment.amount)}</strong></div>)}</div> : <p className="muted">Sin movimientos de dinero registrados.</p>}
      <p className="inline-note">Las ventas sin clienta identificada no se asignan a esta agenda. Los anticipos y los créditos se conservan aunque un pedido se cancele.</p>
    </Modal>}
    {collecting && moneyAction && <CollectPaymentModal key={`${collecting.id}-${moneyAction.refund}`} sale={collecting} data={data} refund={moneyAction.refund} notify={notify} onClose={() => setMoneyAction(null)} />}
  </div>;
}
