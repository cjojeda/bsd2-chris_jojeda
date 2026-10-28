import { useEffect, useState, type ReactNode } from 'react';
import { LayoutDashboard, Package, ShoppingBag, ReceiptText, ChartNoAxesCombined, Users, DatabaseBackup, ArrowUpRight, ArrowRight, Plus, Download, Bell, Menu, X, Check, ShieldCheck, MonitorDown, Sparkles } from 'lucide-react';
import { readSnapshot } from './data/db';
import { seedDemo } from './data/demo';
import { downloadBackup } from './data/transfer';
import { useMonthlyReport, toDashboardSummary } from './data/reports';
import { money, localDate, localMonth, displayDate, currencyCode, currencySymbol } from './domain/format';
import type { Snapshot } from './domain/types';
import { EmptyState, Modal } from './components/ui';
import InventoryPage from './pages/InventoryPage';
import PosPage from './pages/PosPage';
import TransferPage from './pages/TransferPage';
import FinancePage from './pages/FinancePage';
import CustomersPage from './pages/CustomersPage';
import SalesPage from './pages/SalesPage';
import MobileAccess from './components/MobileAccess';

type Page = 'dashboard'|'inventory'|'pos'|'sales'|'finance'|'customers'|'backup';
const navigation: {id:Page;label:string;icon:typeof LayoutDashboard;section?:string}[] = [
  {id:'dashboard',label:'Resumen',icon:LayoutDashboard,section:'TU NEGOCIO'},
  {id:'inventory',label:'Inventario',icon:Package}, {id:'pos',label:'Punto de venta',icon:ShoppingBag},
  {id:'sales',label:'Ventas',icon:ReceiptText}, {id:'finance',label:'Finanzas',icon:ChartNoAxesCombined},
  {id:'customers',label:'Clientas',icon:Users}, {id:'backup',label:'Datos y respaldos',icon:DatabaseBackup,section:'HERRAMIENTAS'},
];
interface InstallPrompt extends Event { prompt():Promise<void>; userChoice:Promise<{outcome:string}> }
export default function App(){
  const [page,setPage]=useState<Page>('dashboard');
  const [month,setMonth]=useState(localMonth());
  const [mobileMenu,setMobileMenu]=useState(false);
  const [toast,setToast]=useState<{message:string;kind:string}|null>(null);
  const [showDemo,setShowDemo]=useState(false);
  const [working,setWorking]=useState(false);
  const [offlineReady,setOfflineReady]=useState(false);
  const [install,setInstall]=useState<InstallPrompt|null>(null);
  const [updateReady,setUpdateReady]=useState(false);
  const [connectionError,setConnectionError]=useState('');
  const [data,setData]=useState<Snapshot|null>(null);
  useEffect(()=>{
    let active=true,version=0;
    const refresh=async()=>{const request=++version;try{const next=await readSnapshot();if(active&&request===version){setData(next);setConnectionError('');}}catch(error){if(active&&request===version)setConnectionError(error instanceof Error?error.message:'No se pudo conectar con el motor local.');}};
    const visibleRefresh=()=>{if(document.visibilityState==='visible')void refresh();};
    void refresh();window.addEventListener('sadi:data-changed',visibleRefresh);window.addEventListener('focus',visibleRefresh);document.addEventListener('visibilitychange',visibleRefresh);
    const interval=setInterval(visibleRefresh,10000);
    return()=>{active=false;clearInterval(interval);window.removeEventListener('sadi:data-changed',visibleRefresh);window.removeEventListener('focus',visibleRefresh);document.removeEventListener('visibilitychange',visibleRefresh);};
  },[]);
  const notify=(message:string,kind:'success'|'error'='success')=>setToast({message,kind});
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),6000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    const ready=()=>setOfflineReady(true);const update=()=>setUpdateReady(true);
    const prompt=(e:Event)=>{e.preventDefault();setInstall(e as InstallPrompt);};
    window.addEventListener('sadi:offline-ready',ready);window.addEventListener('sadi:update-ready',update);window.addEventListener('beforeinstallprompt',prompt);
    navigator.serviceWorker?.getRegistration().then(r=>{if(r?.active)setOfflineReady(true);}).catch(()=>{});
    return()=>{window.removeEventListener('sadi:offline-ready',ready);window.removeEventListener('sadi:update-ready',update);window.removeEventListener('beforeinstallprompt',prompt);};
  },[]);
  const go=(next:Page)=>{setPage(next);setMobileMenu(false);window.scrollTo({top:0});};
  const backup=async()=>{try{await downloadBackup();notify('Respaldo descargado. Guardalo también fuera de esta notebook.');}catch(e){notify(e instanceof Error?e.message:'No pudimos descargar el respaldo.','error');}};
  const loadDemo=async()=>{setWorking(true);try{await seedDemo();setShowDemo(false);notify('Datos de ejemplo cargados. No representan ventas reales.');}catch(e){notify(e instanceof Error?e.message:'No se pudo cargar la demo.','error');}finally{setWorking(false);}};
  if(connectionError&&!data)return <main className="fatal"><DatabaseBackup size={40}/><h1>El motor local no está disponible</h1><p>{connectionError}</p><p>Abrí Sou Linda System en la notebook. Los datos permanecen en su base local.</p><button className="btn btn-primary" onClick={()=>location.reload()}>Reintentar</button></main>;
  if(!data)return <main className="loading-screen"><div className="brand-mark">S</div><p>Preparando tu espacio de trabajo…</p></main>;
  const isDemo=data.settings.some(s=>s.key==='demo'&&s.value==='true');
  const lowStock=data.variants.filter(v=>v.active&&v.available<=v.minStock);
  const empty=!data.products.length&&!data.sales.length&&!data.customers.length&&!data.expenses.length;
  return <div className="app-layout">
    {mobileMenu&&<button className="nav-overlay" aria-label="Cerrar menú" onClick={()=>setMobileMenu(false)}/>}
    <aside className={`sidebar ${mobileMenu?'open':''}`}>
      <a href="#" className="brand" onClick={e=>{e.preventDefault();go('dashboard');}}><span className="brand-mark">S<span>✧</span></span><div><strong className="sou-brand-name">Sou Linda</strong><small>SYSTEM · TU NEGOCIO</small></div></a>
      <div className="workspace-label"><span className="workspace-avatar">L</span><div><strong>Mi lencería</strong><small>Espacio de trabajo local</small></div><span className="tiny-dot"/></div>
      <nav aria-label="Navegación principal">{navigation.map(item=><div key={item.id}>{item.section&&<p className="nav-section">{item.section}</p>}<button onClick={()=>go(item.id)} className={`nav-item ${page===item.id?'active':''}`} aria-current={page===item.id?'page':undefined}><item.icon size={19}/><span>{item.label}</span>{item.id==='inventory'&&lowStock.length>0&&<span className="nav-count">{lowStock.length}</span>}</button></div>)}</nav>
      <div className="sidebar-bottom"><div className="local-note"><ShieldCheck size={19}/><div><strong>Tus datos, con vos.</strong><p>Guardados en tu notebook.<br/>Un respaldo te da tranquilidad.</p></div></div><button className="install-button" onClick={async()=>{if(install){await install.prompt();await install.userChoice;setInstall(null);}else notify('En Chrome o Edge: menú del navegador → Instalar Sou Linda System. El motor local debe permanecer abierto.');}}><MonitorDown size={17}/>Instalar en notebook<ArrowUpRight size={15}/></button><a href="/agil" className="classic-view-switch">Probar vista Ágil <ArrowUpRight size={14}/></a><span className="version">Sou Linda System · v0.5.0 · Clásica</span></div>
    </aside>
    <div className="main-layout"><header className="topbar"><div className="breadcrumb"><button className="icon-btn mobile-menu" aria-label="Abrir menú" onClick={()=>setMobileMenu(true)}><Menu size={22}/></button><span>Mi negocio</span><span className="breadcrumb-slash">/</span><strong>{navigation.find(n=>n.id===page)?.label}</strong></div><div className="topbar-actions"><span className="local-status"><span className="tiny-dot"/>{connectionError?'Sin conexión al motor':offlineReady?'Interfaz instalada · Motor local':'Datos en la notebook'}</span><button className="icon-btn notifications" aria-label={`${lowStock.length} alertas de stock`} onClick={()=>go('inventory')}><Bell size={19}/>{lowStock.length>0&&<span/>}</button><span className="user-avatar" title="Perfil local">MI</span></div></header>
    <main className="main-content">
      {currencyCode()==='ARS'&&<div className="info-banner report-warning" role="status">Esta base conserva los importes de la versión en pesos argentinos (ARS). No se convirtieron a guaraníes. Para empezar la tienda paraguaya, usá una base nueva en PYG y conservá un respaldo de esta base.</div>}
      {connectionError&&<div className="info-banner" role="alert">{connectionError} · Reabrí el motor local para continuar. Los campos actuales se conservarán en esta ventana.</div>}
      {isDemo&&<div className="demo-banner"><Sparkles size={16}/><span>Estás explorando datos de ejemplo. Tus ventas reales empiezan con una base vacía.</span><button onClick={()=>go('backup')}>Administrar datos <ArrowRight size={14}/></button></div>}
      {updateReady&&<div className="info-banner">Hay una nueva versión disponible. Respaldá tus datos y cerrá todas las ventanas de Sou Linda System antes de volver a abrirla.</div>}
      {empty&&page==='dashboard'&&<div className="welcome-banner"><div><Sparkles size={18}/><span>Tu espacio está listo. Cargá tu primer producto o explorá una demo.</span></div><button className="btn btn-small btn-secondary" onClick={()=>setShowDemo(true)}>Explorar demo</button></div>}
      {page==='dashboard'&&<Dashboard data={data} month={month} setMonth={setMonth} go={go}/>}
      {page==='inventory'&&<InventoryPage data={data} notify={notify}/>}
      {page==='pos'&&<PosPage data={data} notify={notify}/>}
      {page==='sales'&&<SalesPage data={data} notify={notify}/>}
      {page==='finance'&&<FinancePage data={data} notify={notify} month={month} setMonth={setMonth}/>}
      {page==='customers'&&<CustomersPage data={data} notify={notify}/>}
      {page==='backup'&&<><MobileAccess notify={notify}/><TransferPage data={data} notify={notify}/></>}
      <footer className="page-footer"><span><ShieldCheck size={14}/>Tu base de datos permanece en la notebook.</span><button onClick={backup}><Download size={14}/>Respaldar mis datos</button></footer>
    </main></div>
    {toast&&<div className={`toast toast-${toast.kind}`} role={toast.kind==='error'?'alert':'status'}>{toast.kind==='success'?<Check size={20}/>:<X size={20}/>}<span>{toast.message}</span><button className="icon-btn" aria-label="Cerrar notificación" onClick={()=>setToast(null)}><X size={16}/></button></div>}
    {showDemo&&<Modal title="Explorá Sou Linda System con datos de ejemplo" onClose={()=>setShowDemo(false)}><p>Vamos a cargar modelos, variantes, clientas, ventas y gastos ficticios para que pruebes todas las pantallas.</p><p className="muted">Solo se puede cargar en una base vacía. Podés eliminar todos los datos de ejemplo desde Datos y respaldos antes de empezar con tu negocio.</p><div className="form-actions"><button className="btn btn-secondary" onClick={()=>setShowDemo(false)}>Volver</button><button className="btn btn-primary" disabled={working} onClick={loadDemo}>{working?'Cargando…':'Cargar datos de ejemplo'}</button></div></Modal>}
  </div>;
}

function Dashboard({data,month,setMonth,go}:{data:Snapshot;month:string;setMonth:(m:string)=>void;go:(p:Page)=>void}){
  const {report,error}=useMonthlyReport(month);
  if(!report)return <section className="panel empty"><h1>{error?'No se pudo cargar el resumen':'Preparando tu resumen…'}</h1>{error&&<p role="alert">{error}</p>}</section>;
  const m=toDashboardSummary(report);const low=data.variants.filter(v=>v.active&&v.available<=v.minStock);
  const monthName=new Intl.DateTimeFormat('es-PY',{month:'long',year:'numeric'}).format(new Date(`${month}-15T12:00:00`));
  const current=new Intl.DateTimeFormat('es-PY',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
  const change=m.previousSalesTotal?Math.round((m.salesTotal/m.previousSalesTotal-1)*100):null;
  const recent=data.sales.filter(s=>s.completedDate?.startsWith(month)).sort((a,b)=>(b.completedDate??'').localeCompare(a.completedDate??'')||b.number.localeCompare(a.number)).slice(0,5);
  const totalStock=data.variants.filter(v=>v.active).reduce((n,v)=>n+v.available,0);
  return <>
    <div className="page-heading dashboard-heading"><div><p className="eyebrow">{current}</p><h1>Tu negocio, en equilibrio<span className="heading-dot">.</span></h1><p className="page-subtitle">Cada venta cuenta. Conocé cómo está creciendo tu lencería.</p></div><button className="btn btn-primary" onClick={()=>go('pos')}><Plus size={18}/>Nueva venta</button></div>
    <div className="period-toolbar"><div><h2>Tu resumen del mes</h2><span className="badge badge-neutral">{currencyCode()} · {currencyCode()==='PYG'?'Guaraníes':'Pesos argentinos'}</span></div><label className="month-picker"><span className="sr-only">Mes del resumen</span><input type="month" aria-label="Mes del resumen" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)}/></label></div>
    {error&&<p className="report-error" role="alert">{error}</p>}
    <div className="stat-grid">
      <Stat label="Ventas totales" value={money(m.salesTotal)} icon={<ShoppingBag size={20}/>} note={change===null?'Sin ventas en el mes anterior':`${change>=0?'+':''}${change}% respecto al mes anterior`} highlight={change!==null&&change>=0}/>
      <Stat label="Ganancia neta" value={m.netProfit===null?'Por completar':money(m.netProfit)} icon={<ChartNoAxesCombined size={20}/>} note={report.incomplete_cost_count?`${report.incomplete_cost_count} ventas sin costo completo`:"Después de costos y gastos"} tone="rose"/>
      <Stat label="Ticket promedio" value={money(m.averageTicket)} icon={<ReceiptText size={20}/>} note={`${m.salesCount} ${m.salesCount===1?'venta registrada':'ventas registradas'}`}/>
      <Stat label="Stock disponible" value={totalStock.toLocaleString('es-PY')} suffix="unidades" icon={<Package size={20}/>} note={low.length?`${low.length} variantes necesitan atención`:'Todo en orden con tu stock'} warning={low.length>0}/>
    </div>
    <div className="dashboard-charts"><section className="panel sales-chart-panel"><div className="panel-head"><div><h2>El pulso de tus ventas</h2><p>Ingresos diarios · {monthName}</p></div><span className="chart-legend"><i/>Ventas</span></div>{m.daily.some(d=>d.total!==0)?<SalesChart daily={m.daily}/>:<EmptyState title="Tu próxima venta empieza acá" detail="Registrá ventas y vas a ver cómo evoluciona tu negocio." action={<button className="btn btn-secondary btn-small" onClick={()=>go('pos')}>Ir al punto de venta<ArrowRight size={15}/></button>}/>}<div className="chart-bottom"><span>Venta registrada ≠ dinero cobrado</span><button onClick={()=>go('finance')}>Ver finanzas<ArrowUpRight size={14}/></button></div></section>
    <section className="panel channel-panel"><div className="panel-head"><div><h2>Canales que conectan</h2><p>Rentabilidad por origen de venta</p></div><span className="small-icon"><ArrowUpRight size={18}/></span></div><div className="channel-list">{m.channels.map((c,i)=><div className="channel-row" key={c.channel}><span className={`channel-icon channel-${c.channel.toLowerCase()}`}>{c.channel==='Instagram'?'◎':c.channel==='WhatsApp'?'◉':c.channel==='TikTok'?'♪':'⌂'}</span><div className="channel-info"><div><strong>{c.channel==='Local'?'Venta presencial':c.channel}</strong><span>{money(c.profit)}</span></div><div className="progress-track"><i style={{width:`${Math.max(0,...m.channels.map(x=>x.profit??0))>0?Math.max(0,c.profit??0)/Math.max(...m.channels.map(x=>x.profit??0))*100:0}%`,background:['#8c3047','#b57583','#c5a08e','#ded0bf'][i]}}/></div><small>{c.count} {c.count===1?'venta':'ventas'} · margen tras envío y empaque</small></div></div>)}</div><div className="subtle-callout"><Sparkles size={16}/><p>{report.incomplete_cost_count?'Completá los costos históricos para comparar los canales.':m.channels.some(c=>(c.profit??0)>0)?<>Tu mayor contribución viene de <strong>{m.channels[0].channel}</strong>.</>:'Cada canal tiene una historia. Consultá sus costos en Finanzas.'}</p></div></section></div>
    <div className="dashboard-bottom"><section className="panel recent-sales"><div className="panel-head"><div><h2>Las últimas ventas</h2><p>Pequeños movimientos, grandes avances.</p></div><button className="text-button" onClick={()=>go('sales')}>Ver todas<ArrowRight size={15}/></button></div>{recent.length?<div className="table-wrap"><table><thead><tr><th>VENTA / CLIENTA</th><th>CANAL</th><th>FECHA</th><th className="align-right">TOTAL</th></tr></thead><tbody>{recent.map(s=><tr key={s.id}><td><div className="sale-customer"><span className="customer-avatar">{(data.customers.find(c=>c.id===s.customerId)?.name||'Venta mostrador').slice(0,1)}</span><div><strong>{data.customers.find(c=>c.id===s.customerId)?.name||'Venta mostrador'}</strong><small>{s.number} · {s.items.reduce((n,i)=>n+i.quantity,0)} prendas</small></div></div></td><td><span className="badge badge-neutral">{s.channel}</span></td><td className="muted">{displayDate(s.date)}</td><td className="align-right"><strong>{money(s.total)}</strong></td></tr>)}</tbody></table></div>:<EmptyState title="Un nuevo comienzo" detail="Tus ventas más recientes van a aparecer en este espacio."/>}</section>
    <section className="panel stock-attention"><div className="panel-head"><div><h2>Un ojo en el stock</h2><p>Los favoritos que necesitan reposición.</p></div><span className={`badge ${low.length?'badge-warning':'badge-success'}`}>{low.length} alertas</span></div>{low.length?<div className="stock-alert-list">{low.slice(0,4).map(v=><div className="stock-alert" key={v.id}><span className="product-symbol"><ShoppingBag size={20}/></span><div><strong>{data.products.find(p=>p.id===v.productId)?.name}</strong><small>Talle {v.size} · {v.color}</small></div><span className={`stock-pill ${v.available===0?'zero':''}`}>{v.available===0?'Agotado':`${v.available} unid.`}</span></div>)}</div>:<div className="stock-calm"><ShieldCheck size={29}/><strong>Todo bajo control</strong><p>Las alertas aparecen cuando una variante alcanza su stock mínimo.</p></div>}<button className="stock-link" onClick={()=>go('inventory')}>Administrar inventario<ArrowRight size={16}/></button></section></div>
    {m.outstanding>0&&<div className="credit-notice"><ReceiptText size={18}/><span>Tenés <strong>{money(m.outstanding)}</strong> pendientes de cobro en tu historial.</span><button onClick={()=>go('sales')}>Gestionar cobros<ArrowRight size={15}/></button></div>}
  </>;
}
function Stat({label,value,icon,note,tone,highlight,warning,suffix}:{label:string;value:string;icon:ReactNode;note:string;tone?:string;highlight?:boolean;warning?:boolean;suffix?:string}){return <article className={`stat-card ${tone==='rose'?'stat-rose':''}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><div className="stat-value">{value}{suffix&&<small>{suffix}</small>}</div><p className={warning?'stat-warning':highlight?'stat-positive':''}>{highlight&&<ArrowUpRight size={13}/>} {note}</p></article>;}
function SalesChart({daily}:{daily:{date:string;total:number}[]}){
  const width=720,height=215,pad=12,max=Math.max(100,...daily.map(d=>d.total))*1.15,min=Math.min(0,...daily.map(d=>d.total))*1.15;
  const y=(value:number)=>height-pad-(value-min)/(max-min)*(height-pad*2);
  const pts=daily.map((d,i)=>[pad+i/(daily.length-1||1)*(width-pad*2),y(d.total)]);
  const path=pts.map((p,i)=>`${i?'L':'M'}${p[0]},${p[1]}`).join(' ');
  const compact=(n:number)=>new Intl.NumberFormat('es-PY',{notation:'compact',maximumFractionDigits:0}).format(n/100);
  return <div className="sales-chart"><div className="chart-y">{[1,.75,.5,.25,0].map(n=><span key={n}>{currencySymbol()} {compact(min+(max-min)*n)}</span>)}</div><div className="chart-plot"><svg role="img" aria-label="Ventas diarias del mes seleccionado" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><defs><linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a94b62" stopOpacity=".24"/><stop offset="100%" stopColor="#a94b62" stopOpacity=".01"/></linearGradient></defs>{[0,.25,.5,.75,1].map(n=><line key={n} x1="0" x2={width} y1={pad+n*(height-pad*2)} y2={pad+n*(height-pad*2)} stroke="#eee8e2" strokeDasharray="4 4"/>)}<path d={`${path} L${width-pad},${y(0)} L${pad},${y(0)} Z`} fill="url(#sales-fill)"/><line x1={pad} x2={width-pad} y1={y(0)} y2={y(0)} stroke="#c7b8b5"/><path d={path} fill="none" stroke="#963a53" strokeWidth="2.8" strokeLinejoin="round"/>{pts.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r={daily[i].total?3.4:0} fill="#963a53"><title>{displayDate(daily[i].date)}: {money(daily[i].total)}</title></circle>)}</svg><div className="chart-x">{[1,5,10,15,20,25,daily.length].map((n,i)=><span key={i}>{String(n).padStart(2,'0')}</span>)}</div></div></div>;
}
