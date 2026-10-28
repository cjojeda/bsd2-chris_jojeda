import { ArrowDownLeft, ArrowRight, ArrowUpRight, CircleDollarSign, Clock3, Package, Plus, ShoppingBag, Sparkles, Tag, TrendingUp, Users, Wallet } from 'lucide-react';
import { useDailyReport, useMonthlyReport } from '../data/reports';
import { displayDate, localDate, localMonth, money } from '../domain/format';
import type { Snapshot } from '../domain/types';
import type { AgilePage } from './types';
import { openOrderCounts, orderStatusLabel, recentOrderActivity, stockAlerts, stockOverview } from './selectors';

interface Props {
  data: Snapshot;
  go: (page: AgilePage) => void;
  notify: (message: string, kind?: 'success' | 'error') => void;
}

export default function AgileHome({ data, go }: Props) {
  const today = localDate();
  const daily = useDailyReport(today, 0);
  const monthly = useMonthlyReport(localMonth());
  const cash = daily.report;
  const report = monthly.report;
  const stock = stockOverview(data.variants);
  const alerts = stockAlerts(data);
  const orders = openOrderCounts(data.sales);
  const recent = recentOrderActivity(data.sales);
  const todayName = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${today}T12:00:00`));
  const monthName = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(new Date(`${localMonth()}-15T12:00:00`));
  const units = (value: number | null) => value === null ? 'Ver inventario' : value.toLocaleString('es-AR');
  const amount = (value: number | undefined) => value === undefined ? 'Consultando…' : money(value);
  return <div className="ag-home">
    <section className="ag-home-hero">
      <div><p className="ag-kicker">{todayName}</p><h1>Tu negocio, al día<span>.</span></h1><p>Vendé, controlá tus prendas y seguí tus números desde un solo lugar.</p></div>
      <svg className="ag-brand-motif" viewBox="0 0 190 120" aria-hidden="true"><path d="M19 87 22 28 88 7 157 27 172 92 101 114Z" fill="none" stroke="#c4af79" strokeWidth=".8"/><path d="M12 40 104 2 181 73 122 116" fill="none" stroke="#d9ccaa" strokeWidth=".7"/><g fill="#f3dce5"><ellipse cx="141" cy="24" rx="12" ry="6" transform="rotate(-30 141 24)"/><ellipse cx="147" cy="33" rx="10" ry="6" transform="rotate(35 147 33)"/><ellipse cx="131" cy="37" rx="11" ry="7" transform="rotate(-55 131 37)"/><ellipse cx="127" cy="23" rx="10" ry="6" transform="rotate(45 127 23)"/></g><circle cx="136" cy="30" r="4" fill="#b97a93"/><path d="M153 17q15-17 20-9-5 15-20 9m-28 22q-19 6-19 14 16 5 19-14" fill="#bec9b8" opacity=".8"/></svg>
      <button className="btn btn-primary ag-register-sale" onClick={() => go('pos')}><Plus size={21} />Registrar venta</button>
    </section>

    <section className="ag-today" aria-labelledby="ag-today-title">
      <div className="ag-section-heading"><div><h2 id="ag-today-title">Así se mueve tu día</h2><p>Cobros y pagos reales · {displayDate(today)}</p></div><button className="ag-link" onClick={() => go('cash')}>Ver caja<ArrowRight size={15} /></button></div>
      {daily.error && <div className="ag-report-warning" role="alert">{daily.error}{cash ? ' Se conserva la última consulta recibida.' : ''}<button onClick={daily.refresh}>Reintentar</button></div>}
      <div className="ag-today-grid">
        <article className="ag-metric"><span className="ag-metric-icon ag-metric-in"><ArrowDownLeft size={19} /></span><span>Cobraste hoy</span><strong>{amount(cash?.receipts_cents)}</strong><small>Incluye anticipos y cobros de fiado.</small></article>
        <article className="ag-metric"><span className="ag-metric-icon ag-metric-out"><ArrowUpRight size={19} /></span><span>Pagaste hoy</span><strong>{amount(cash?.expenses_cents)}</strong><small>Gastos, compras, comisiones y reintegros.</small></article>
        <article className="ag-metric"><span className="ag-metric-icon"><Wallet size={19} /></span><span>Movimiento neto</span><strong className={cash && cash.receipts_cents < cash.expenses_cents ? 'ag-negative' : ''}>{cash ? money(cash.receipts_cents - cash.expenses_cents) : 'Consultando…'}</strong><small>Cobros menos pagos; no es ganancia.</small></article>
        <article className="ag-metric"><span className="ag-metric-icon ag-metric-stock"><Package size={19} /></span><span>Prendas disponibles</span><strong>{units(stock.availableUnits)}</strong><small>{stock.variantCount} variantes · {units(stock.reservedUnits)} unidades reservadas.</small></article>
      </div>
    </section>

    <section className="ag-shortcuts" aria-label="Accesos rápidos">
      <button onClick={() => go('pos')}><span className="ag-shortcut-icon"><ShoppingBag size={21} /></span><span><strong>Nueva venta</strong><small>Elegí modelo, talle y color</small></span><ArrowRight size={17} /></button>
      <button onClick={() => go('inventory')}><span className="ag-shortcut-icon"><Tag size={21} /></span><span><strong>Mis productos</strong><small>Stock, precios y reposición</small></span><ArrowRight size={17} /></button>
      <button onClick={() => go('customers')}><span className="ag-shortcut-icon"><Users size={21} /></span><span><strong>Mis clientas</strong><small>Talles, compras y saldos</small></span><ArrowRight size={17} /></button>
      <button onClick={() => go('expenses')}><span className="ag-shortcut-icon"><CircleDollarSign size={21} /></span><span><strong>Registrar gasto</strong><small>Anotá lo que sale del negocio</small></span><ArrowRight size={17} /></button>
    </section>

    <div className="ag-home-columns">
      <section className="ag-card ag-activity" aria-labelledby="ag-activity-title">
        <div className="ag-card-heading"><div><h2 id="ag-activity-title">Últimos pedidos</h2><p>Ventas, reservas y pendientes en un vistazo.</p></div><button className="ag-link" onClick={() => go('sales')}>Ver todos<ArrowRight size={15} /></button></div>
        {recent.length ? <div className="ag-order-list">{recent.map(({ sale, date }) => <button className="ag-order-row" key={sale.id} onClick={() => go('sales')}>
          <span className={`ag-order-symbol ag-order-symbol-${sale.status}`}>{sale.status === 'pending' || sale.status === 'reserved' ? <Clock3 size={19} /> : <ShoppingBag size={19} />}</span>
          <span className="ag-order-description"><strong>{sale.customerName || data.customers.find(customer => customer.id === sale.customerId)?.name || 'Venta mostrador'}</strong><small>{sale.number} · {sale.channel === 'Local' ? 'Presencial' : sale.channel} · {displayDate(date)}</small><span className={`ag-order-status ag-order-status-${sale.status}`}>{orderStatusLabel(sale)}</span></span>
          <span className="ag-order-amount"><strong>{money(sale.total)}</strong><small>{sale.returnedRevenue > 0 ? `Devoluciones: ${money(sale.returnedRevenue)}` : sale.status === 'completed' ? 'Total del pedido' : 'Importe del pedido'}</small></span>
        </button>)}</div> : <div className="ag-empty"><ShoppingBag size={32} /><h3>Tu primera venta empieza acá</h3><p>Cargá tus productos y registrá tu primer pedido.</p><button className="btn btn-secondary" onClick={() => go(data.products.length ? 'pos' : 'inventory')}>{data.products.length ? 'Registrar una venta' : 'Agregar productos'}</button></div>}
        <div className="ag-pending-strip"><Clock3 size={17} /><span><strong>{orders.pending}</strong> pendientes de confirmar · <strong>{orders.reserved}</strong> con stock reservado</span><button className="ag-link" onClick={() => go('sales')}>Gestionar</button></div>
      </section>

      <div className="ag-home-aside">
        <section className="ag-card ag-month-card" aria-labelledby="ag-month-title"><div className="ag-card-heading"><div><p className="ag-kicker">TU MES EN NÚMEROS</p><h2 id="ag-month-title">Resultado de {monthName}</h2></div><TrendingUp size={22} /></div>
          {monthly.error && <div className="ag-report-warning" role="alert">{monthly.error}{report ? ' Se conserva la última consulta.' : ''}<button onClick={monthly.refresh}>Reintentar</button></div>}
          <div className="ag-month-value"><small>Ganancia neta de gestión</small><strong className={report?.net_profit_cents !== null && report && report.net_profit_cents < 0 ? 'ag-negative' : ''}>{!report ? 'Consultando…' : report.net_profit_cents === null ? 'Por completar' : money(report.net_profit_cents)}</strong><p>{report?.incomplete_cost_count ? `${report.incomplete_cost_count} operaciones sin costo histórico completo.` : 'Después de mercadería, comisiones, envíos, empaque y gastos registrados.'}</p></div>
          <div className="ag-month-details"><div><span>Ventas netas</span><strong>{amount(report?.revenue_cents)}</strong></div><div><span>Por cobrar · todo el historial</span><strong>{amount(report?.outstanding_cents)}</strong></div><div><span>Saldo a favor de clientas</span><strong>{amount(report?.customer_credit_cents)}</strong></div></div>
          <p className="ag-finance-note">Los saldos a favor se muestran por separado. La ganancia es anterior a impuestos no registrados.</p><button className="ag-link" onClick={() => go('finance')}>Ver rentabilidad por canal<ArrowRight size={15} /></button>
        </section>

        <section className="ag-card ag-restock" aria-labelledby="ag-restock-title"><div className="ag-card-heading"><div><h2 id="ag-restock-title">Atención a estos talles</h2><p>{alerts.length ? `${alerts.length} variantes en el mínimo o por debajo.` : 'Tu stock está al día.'}</p></div><Package size={21} /></div>
          {alerts.length ? <div className="ag-restock-list">{alerts.slice(0, 3).map(({ variant, productName }) => <button key={variant.id} onClick={() => go('inventory')}><span><strong>{productName}</strong><small>Talle {variant.size} · {variant.color}</small></span><span className={variant.available === 0 ? 'ag-out-of-stock' : ''}>{variant.available === 0 ? 'Agotado' : `${variant.available} unid.`}</span></button>)}</div> : <div className="ag-stock-calm"><Sparkles size={22} /><p>Las alertas aparecen por talle y color, según su stock disponible.</p></div>}
          <button className="ag-link" onClick={() => go('inventory')}>Revisar inventario<ArrowRight size={15} /></button>
        </section>
      </div>
    </div>
  </div>;
}
