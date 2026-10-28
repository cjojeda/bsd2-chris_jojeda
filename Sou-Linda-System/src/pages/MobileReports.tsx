import { useEffect, useReducer, useState } from 'react';
import { AlertCircle, Eye, Laptop, RefreshCw, ShieldCheck, Wifi } from 'lucide-react';
import { displayDate, localMonth, money } from '../domain/format';
import { validateMonthlyReport, type MonthlyReport } from '../data/reports';

interface MobileAccess { token: string | null; storageWarning: boolean }
// Keep the current permission in memory if sessionStorage is disabled. React's
// development StrictMode may evaluate an initializer twice after URL cleanup.
let transientToken: string | null = null;
function mobileAccess(): MobileAccess {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const incoming = parameters.get('token');
  let cached: string | null = null, storageWarning = false;
  try { cached = sessionStorage.getItem('sadi.mobile.token'); } catch { storageWarning = true; }
  const candidate = incoming ?? cached ?? (storageWarning ? transientToken : null);
  const token = candidate && /^[A-Za-z0-9._~-]{16,512}$/.test(candidate) ? candidate : null;
  if (incoming !== null) {
    transientToken = token;
    try {
      if (token) sessionStorage.setItem('sadi.mobile.token', token);
      else sessionStorage.removeItem('sadi.mobile.token');
    } catch { storageWarning = true; }
    // The token never becomes a query string and is removed from the visible URL.
    try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* A restricted history API does not grant additional access. */ }
  }
  return { token, storageWarning };
}

interface MobileState {
  month: string;
  report: MonthlyReport | null;
  loading: boolean;
  error: string | null;
  revoked: boolean;
  updatedAt: Date | null;
}

function useMobileReport(token: string | null, month: string) {
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const [state, setState] = useState<MobileState>({ month: '', report: null, loading: Boolean(token), error: null, revoked: false, updatedAt: null });
  useEffect(() => {
    if (!token || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
    let active = true, inFlight = false, revoked = false;
    let controller: AbortController | null = null;
    setState(previous => ({ month, report: previous.month === month ? previous.report : null, loading: true, error: null, revoked: false, updatedAt: previous.month === month ? previous.updatedAt : null }));
    const load = async () => {
      if (!active || inFlight || revoked || document.visibilityState === 'hidden') return;
      inFlight = true;
      controller = new AbortController();
      setState(previous => ({ ...previous, loading: true }));
      try {
        // This route is report-only. It never creates an admin session/cookie.
        const response = await fetch(`/api/mobile/reports?month=${encodeURIComponent(month)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', signal: controller.signal });
        if (response.status === 401 || response.status === 403) {
          revoked = true;
          try { if (sessionStorage.getItem('sadi.mobile.token') === token) sessionStorage.removeItem('sadi.mobile.token'); } catch { /* Token remains only in this component's memory. */ }
          throw new Error('Este acceso fue revocado o venció. Abrí un QR nuevo desde la notebook.');
        }
        if (!response.ok) throw new Error('La notebook no pudo preparar el informe. Volvé a intentar en unos instantes.');
        const report = validateMonthlyReport(await response.json());
        if (report.month !== month) throw new Error('La notebook devolvió otro período. Volvé a seleccionar el mes.');
        if (active) setState({ month, report, loading: false, error: null, revoked: false, updatedAt: new Date() });
      } catch (error) {
        if (!active || controller?.signal.aborted) return;
        const message = error instanceof TypeError ? 'No podemos conectar con la notebook. Comprobá que Sou Linda System siga abierto y que ambos dispositivos estén en la misma Wi-Fi.' : error instanceof Error ? error.message : 'No se pudo actualizar el informe desde la notebook.';
        if (active) setState(previous => ({ ...previous, month, report: revoked ? null : previous.report, loading: false, error: message, revoked }));
      } finally { inFlight = false; }
    };
    void load();
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    return () => { active = false; controller?.abort(); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); window.removeEventListener('online', onVisible); };
  }, [token, month, revision]);
  return { ...state, report: state.month === month ? state.report : null, refresh };
}

export default function MobileReports() {
  const [access, setAccess] = useState(mobileAccess);
  const [month, setMonth] = useState(localMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const reportState = useMobileReport(access.token, month);
  const report = reportState.report;
  const lastUpdate = reportState.updatedAt?.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const selected = report?.daily.find(row => row.date === selectedDay);
  useEffect(() => {
    // A newly scanned QR can replace the fragment in an already open tab.
    const onAccess = () => { if (new URLSearchParams(location.hash.slice(1)).has('token')) setAccess(mobileAccess()); };
    window.addEventListener('hashchange', onAccess);
    return () => window.removeEventListener('hashchange', onAccess);
  }, []);
  return <main className="mobile-report-shell">
    <header className="mobile-report-header"><div className="mobile-report-brand"><span className="brand-mark">S</span><div><strong>Sou Linda System</strong><small>Tu negocio, en equilibrio</small></div></div><span className="badge badge-neutral"><Eye size={13} />Solo lectura</span></header>
    <div className="mobile-report-intro"><p className="eyebrow">TU NEGOCIO, CERCA</p><h1>Una mirada a tus números<span className="heading-dot">.</span></h1><p>Consultá los reportes desde el celular. Los datos se guardan en la notebook.</p></div>
    {!access.token ? <section className="panel mobile-access-empty"><div className="empty"><Laptop size={38} /><h2>Abrí el acceso desde tu notebook</h2><p>En Sou Linda System, generá el QR de reportes y escanealo con este celular. Ambos dispositivos deben estar en la misma Wi-Fi.</p><span className="badge badge-neutral">El celular no puede modificar ventas ni inventario.</span></div></section> : <>
      <div className="mobile-report-period"><label className="field"><span>Mes del informe</span><input type="month" aria-label="Mes del informe móvil" value={month} onChange={event => { if (event.target.value) { setMonth(event.target.value); setSelectedDay(null); } }} /></label><button className="btn btn-secondary" aria-label="Actualizar informe" disabled={reportState.loading || reportState.revoked} onClick={reportState.refresh}><RefreshCw size={16} />Actualizar</button></div>
      {access.storageWarning && <p className="info-banner">Este navegador no conserva el permiso de acceso durante la sesión. Si recargás, puede ser necesario escanear el QR otra vez.</p>}
      {reportState.error && <div className="info-banner report-error mobile-report-error" role="alert"><AlertCircle size={19} /><div><strong>{reportState.revoked ? 'Necesitás un acceso nuevo' : 'No pudimos actualizar'}</strong><p>{reportState.error}</p>{report && <small>Se muestra la última consulta recibida, que puede estar desactualizada.</small>}</div></div>}
      {!report && reportState.loading && <div className="panel"><div className="empty" role="status"><RefreshCw size={28} /><h2>Consultando la notebook…</h2><p>Estamos leyendo el resultado del mes seleccionado.</p></div></div>}
      {report && <>
        <div className="mobile-report-connection"><Wifi size={14} /><span>{reportState.loading ? 'Actualizando desde la notebook…' : `Última consulta: ${lastUpdate}`}</span></div>
        {report.incomplete_cost_count > 0 && <div className="info-banner report-warning" role="status"><AlertCircle size={18} /><span>{report.incomplete_cost_count} operaciones sin costo histórico completo. La ganancia real sigue pendiente.</span></div>}
        <div className="mobile-report-stats"><MobileStat label="Ventas netas" value={money(report.revenue_cents)} note="Después de descuentos y devoluciones" /><MobileStat label="Ganancia neta de gestión" value={report.net_profit_cents === null ? 'Incompleta' : money(report.net_profit_cents)} note="Antes de impuestos no registrados" featured /><MobileStat label="Ticket promedio" value={money(report.average_ticket_cents)} note={`${report.sales_count} ventas nuevas completadas`} /><MobileStat label="Mercadería vendida" value={money(report.cogs_cents)} note="CPP histórico; no es una salida de caja de hoy" /></div>
        <section className="panel"><div className="panel-head"><div><h2>El pulso del mes</h2><p>Tocá una barra para ver ventas y devoluciones de ese día.</p></div></div><MobileDailyChart rows={report.daily} selectedDay={selectedDay} select={setSelectedDay} /><div className="mobile-chart-detail">{selected ? <><span>{displayDate(selected.date)}</span><strong>{money(selected.total_cents)}</strong></> : <span>Las devoluciones pueden producir días negativos.</span>}</div></section>
        <section className="panel"><div className="panel-head"><div><h2>De ingresos a ganancia</h2><p>Todos los importes se calculan en la notebook.</p></div></div><dl className="mobile-financial-lines"><MobileLine label="Ingresos netos" amount={report.revenue_cents} /><MobileLine label="Costo de mercadería" amount={report.cogs_cents} /><MobileLine label="Comisiones efectivas" amount={report.commission_cents} /><MobileLine label="Envíos asumidos" amount={report.shipping_cents} /><MobileLine label="Packaging" amount={report.packaging_cents} /><MobileLine label="Gastos operativos" amount={report.operating_cents} /><MobileLine label="Pérdidas de inventario" amount={report.loss_cents} /><div className="mobile-financial-total"><dt>Ganancia neta</dt><dd className={report.net_profit_cents !== null && report.net_profit_cents < 0 ? 'danger-text' : ''}>{report.net_profit_cents === null ? 'Pendiente de costos' : money(report.net_profit_cents)}</dd></div></dl></section>
        <section className="panel"><div className="panel-head"><div><h2>Canales que conectan</h2><p>Después de costos directos y gastos atribuibles.</p></div></div><div className="mobile-channel-list">{report.channels.map(row => <article className="mobile-channel" key={row.channel}><div><strong>{row.channel === 'Local' ? 'Venta presencial' : row.channel}</strong><strong className={row.profit_cents !== null && row.profit_cents < 0 ? 'danger-text' : ''}>{row.profit_cents === null ? 'Incompleto' : money(row.profit_cents)}</strong></div><p>{row.sales_count} ventas nuevas · Ingresos netos {money(row.revenue_cents)}</p></article>)}</div><p className="accounting-note">{report.allocation_mode === 'net_revenue_proportion' ? 'Incluye prorrateo de gastos compartidos por ventas netas positivas.' : 'Los gastos compartidos no se asignan a una red social de forma arbitraria.'}<br />Gastos sin asignar: {money(report.unallocated_expense_cents)}.</p></section>
        <section className="panel"><div className="panel-head"><div><h2>Ventas y dinero son distintos</h2><p>Saldos de todo el historial.</p></div></div><dl className="mobile-financial-lines"><MobileLine label="Pendiente de cobro" amount={report.outstanding_cents} /><MobileLine label="Crédito a favor de clientas" amount={report.customer_credit_cents} /><MobileLine label="Anticipos sin entrega" amount={report.advances_cents} /></dl><p className="accounting-note">Estos saldos no son el efectivo de caja. El fiado se cobra después; los anticipos todavía no son ventas completadas.</p></section>
      </>}
    </>}
    <footer className="mobile-report-footer"><ShieldCheck size={17} /><p>Datos en tu notebook · Acceso de solo lectura.<br />Este acceso no crea otra base de datos en el celular. La notebook y Sou Linda System deben permanecer encendidos.</p></footer>
  </main>;
}

function MobileStat({ label, value, note, featured = false }: { label: string; value: string; note: string; featured?: boolean }) {
  return <article className={`stat-card ${featured ? 'stat-rose' : ''}`}><div className="stat-top"><span>{label}</span></div><div className="stat-value">{value}</div><p>{note}</p></article>;
}
function MobileLine({ label, amount }: { label: string; amount: number }) { return <div><dt>{label}</dt><dd className={amount < 0 ? 'danger-text' : ''}>{money(amount)}</dd></div>; }

function MobileDailyChart({ rows, selectedDay, select }: { rows: MonthlyReport['daily']; selectedDay: string | null; select: (day: string) => void }) {
  const width = 680, height = 175, pad = 12;
  const maximum = Math.max(0, ...rows.map(row => row.total_cents)), minimum = Math.min(0, ...rows.map(row => row.total_cents));
  const span = maximum - minimum || 1, scale = (height - pad * 2) / span;
  const baseline = pad + maximum * scale, unit = (width - pad * 2) / Math.max(rows.length, 1);
  return <div className="mobile-report-chart"><svg viewBox={`0 0 ${width} ${height + 24}`} role="img" aria-label="Ingresos netos por día, incluyendo devoluciones"><line x1={pad} x2={width - pad} y1={baseline} y2={baseline} stroke="#d9cfc4" />{rows.map((row, index) => {
    const barHeight = Math.max(Math.abs(row.total_cents) * scale, 1.5);
    return <g key={row.date}><rect x={pad + index * unit + 1.5} y={row.total_cents >= 0 ? baseline - barHeight : baseline} width={Math.max(unit - 3, 2)} height={barHeight} rx="3" fill={selectedDay === row.date ? '#5c2035' : row.total_cents < 0 ? '#b57d64' : '#99465d'} role="button" tabIndex={0} aria-label={`${row.date}: ${money(row.total_cents)}`} onClick={() => select(row.date)} onFocus={() => select(row.date)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(row.date); } }}><title>{row.date}: {money(row.total_cents)}</title></rect>{(index === 0 || (index + 1) % 5 === 0 || index === rows.length - 1) && <text x={pad + index * unit + unit / 2} y={height + 17} textAnchor="middle" fill="#9c8674" fontSize="13">{row.date.slice(-2)}</text>}</g>;
  })}</svg></div>;
}
