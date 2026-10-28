import { useEffect, useState } from 'react';
import { ArrowLeftRight, ArrowUpRight, Check, ChartNoAxesCombined, DatabaseBackup, Download, Home, Layers3, Menu, Package, Plus, ReceiptText, RefreshCw, ShieldCheck, ShoppingBag, Sparkles, Users, Wallet, X } from 'lucide-react';
import { seedDemo } from '../data/demo';
import { downloadBackup } from '../data/transfer';
import { localMonth } from '../domain/format';
import { Modal } from '../components/ui';
import MobileAccess from '../components/MobileAccess';
import InventoryPage from '../pages/InventoryPage';
import PosPage from '../pages/PosPage';
import SalesPage from '../pages/SalesPage';
import CustomersPage from '../pages/CustomersPage';
import FinancePage from '../pages/FinancePage';
import TransferPage from '../pages/TransferPage';
import AgileHome from './AgileHome';
import { useNotebookData } from './useNotebookData';
import type { AgilePage } from './types';
import './agile.css';

const navigation:{page:AgilePage;label:string;icon:typeof Home}[]=[
  {page:'home',label:'Inicio',icon:Home},
  {page:'sales',label:'Ventas y pedidos',icon:ReceiptText},
  {page:'inventory',label:'Productos',icon:Package},
  {page:'customers',label:'Clientas',icon:Users},
  {page:'cash',label:'Caja diaria',icon:Wallet},
  {page:'finance',label:'Reportes',icon:ChartNoAxesCombined},
  {page:'backup',label:'Datos y respaldos',icon:DatabaseBackup},
];
const allPages:AgilePage[]=['home','pos','sales','inventory','customers','cash','finance','expenses','backup'];
const initialPage=():AgilePage=>{
  const requested=new URLSearchParams(location.search).get('section');
  return allPages.includes(requested as AgilePage)?requested as AgilePage:'home';
};

export default function AgileApp(){
  const {data,error,retry}=useNotebookData();
  const [page,setPage]=useState<AgilePage>(initialPage);
  const [month,setMonth]=useState(localMonth());
  const [drawer,setDrawer]=useState(false);
  const [toast,setToast]=useState<{text:string;kind:'success'|'error'}|null>(null);
  const [demoOpen,setDemoOpen]=useState(false);
  const [working,setWorking]=useState(false);
  const [updateAvailable,setUpdateAvailable]=useState(false);
  const notify=(text:string,kind:'success'|'error'='success')=>setToast({text,kind});
  const go=(next:AgilePage)=>{
    setPage(next);setDrawer(false);
    history.replaceState(null,'',next==='home'?'/agil':`/agil?section=${next}`);
    window.scrollTo({top:0});
  };
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),6000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{
    const update=()=>setUpdateAvailable(true);
    const shortcut=(event:KeyboardEvent)=>{if(event.key==='F2'){event.preventDefault();go('pos');}};
    window.addEventListener('sadi:update-ready',update);window.addEventListener('keydown',shortcut);
    return()=>{window.removeEventListener('sadi:update-ready',update);window.removeEventListener('keydown',shortcut);};
  },[]);
  const backup=async()=>{try{await downloadBackup();notify('Respaldo descargado. Guardá una copia fuera de la notebook.');}catch(e){notify(e instanceof Error?e.message:'No se pudo generar el respaldo.','error');}};
  const loadDemo=async()=>{if(working)return;setWorking(true);try{await seedDemo();setDemoOpen(false);notify('Demo cargada. Todos los datos son de ejemplo.');}catch(e){notify(e instanceof Error?e.message:'No se pudo cargar la demo.','error');}finally{setWorking(false);}};

  if(!data)return <main className="ag-app ag-connection-screen"><span className="ag-logo">S</span><h1>Sou Linda System</h1>{error?<><p role="alert">{error}</p><p>Abrí el motor local en la notebook para continuar.</p><button className="btn btn-primary" onClick={retry}><RefreshCw size={17}/>Reintentar</button></>:<p role="status">Preparando tu negocio…</p>}<a href="/">Abrir vista Clásica</a></main>;
  const isDemo=data.settings.some(setting=>setting.key==='demo'&&setting.value==='true');
  const empty=!data.products.length&&!data.sales.length&&!data.customers.length&&!data.expenses.length;
  const attention=data.variants.filter(variant=>variant.active&&variant.available<=variant.minStock).length;
  const activePage=page==='expenses'?'cash':page;
  const title=page==='pos'?'Nueva venta':page==='expenses'?'Registrar gasto':navigation.find(item=>item.page===page)?.label??'Mi negocio';

  return <div className="ag-app">
    {drawer&&<button className="ag-drawer-shade" aria-label="Cerrar menú" onClick={()=>setDrawer(false)}/>}
    <aside className={`ag-sidebar ${drawer?'is-open':''}`}>
      <a className="ag-brand" href="/agil" onClick={event=>{event.preventDefault();go('home');}}><span className="ag-logo">S<span>✧</span></span><div><strong>Sou Linda</strong><small>SYSTEM</small></div></a>
      <div className="ag-business"><span className="ag-business-avatar"><ShoppingBag size={18}/></span><div><strong>Mi lencería</strong><small>Mi negocio · ARS</small></div><span className="ag-business-dot"/></div>
      <button className="ag-sale-button" onClick={()=>go('pos')}><Plus size={20}/><span>Registrar venta</span><kbd>F2</kbd></button>
      <p className="ag-nav-heading">MI NEGOCIO</p>
      <nav aria-label="Navegación de Sou Linda Ágil">{navigation.map(({page:target,label,icon:Icon})=><button key={target} className={`ag-nav-item ${activePage===target?'is-active':''}`} onClick={()=>go(target)} aria-current={activePage===target?'page':undefined}><Icon size={19}/><span>{label}</span>{target==='inventory'&&attention>0&&<span className="ag-nav-count">{attention}</span>}</button>)}</nav>
      <div className="ag-sidebar-bottom"><div className="ag-local-note"><ShieldCheck size={20}/><div><strong>Tu negocio queda con vos</strong><p>Datos guardados en tu notebook.</p></div></div><a className="ag-switch" href="/"><ArrowLeftRight size={16}/><span>Probar vista Clásica</span><ArrowUpRight size={14}/></a><div className="ag-edition"><span className="ag-edition-dot"/>Vista Ágil <span>v0.4.0</span></div></div>
    </aside>
    <div className="ag-body"><header className="ag-topbar"><div className="ag-crumb"><button className="icon-btn ag-menu-toggle" aria-label="Abrir menú" onClick={()=>setDrawer(true)}><Menu size={22}/></button><span>Mi lencería</span><span>/</span><strong>{title}</strong></div><div className="ag-topbar-actions"><span className={`ag-connection ${error?'is-offline':''}`}><i/>{error?'Motor sin conexión':'Guardado en notebook'}</span><button className="ag-backup-top" onClick={backup}><Download size={16}/><span>Respaldar</span></button><span className="ag-profile" aria-label="Negocio local">SL</span></div></header>
      <main className={`ag-main ${page==='pos'?'ag-main-pos':''}`}>
        {error&&<div className="report-error" role="alert">{error}<button className="text-button" onClick={retry}>Reintentar</button></div>}
        {isDemo&&<div className="ag-demo"><Sparkles size={15}/><span>Datos de ejemplo. Explorá todas las funciones antes de cargar tu negocio.</span><button onClick={()=>go('backup')}>Administrar demo<ArrowUpRight size={14}/></button></div>}
        {updateAvailable&&<div className="info-banner">Hay una actualización de la interfaz. Respaldá los datos y cerrá las ventanas del sistema antes de volver a abrirlo.</div>}
        {empty&&page==='home'&&<div className="ag-welcome"><div><Layers3 size={21}/><span><strong>Todo listo para tu primera venta</strong><small>Agregá tus productos o probá Sou Linda con una demo.</small></span></div><button className="btn btn-secondary" onClick={()=>setDemoOpen(true)}>Explorar demo</button></div>}
        {page==='home'&&<AgileHome data={data} go={go} notify={notify}/>}
        {page==='pos'&&<PosPage data={data} notify={notify}/>}
        {page==='sales'&&<SalesPage data={data} notify={notify}/>}
        {page==='inventory'&&<InventoryPage data={data} notify={notify}/>}
        {page==='customers'&&<CustomersPage data={data} notify={notify}/>}
        {(page==='finance'||page==='cash'||page==='expenses')&&<FinancePage key={page} data={data} notify={notify} month={month} setMonth={setMonth} initialTab={page==='finance'?'month':'daily'} openExpense={page==='expenses'}/>}
        {page==='backup'&&<><MobileAccess notify={notify}/><TransferPage data={data} notify={notify}/></>}
        <footer className="ag-footer"><span><ShieldCheck size={14}/>Sou Linda System · Datos en esta notebook</span><span>Vista Ágil <span aria-hidden="true">·</span> <a href="/">Cambiar a Clásica</a></span></footer>
      </main>
    </div>
    {toast&&<div className={`toast toast-${toast.kind}`} role={toast.kind==='error'?'alert':'status'}>{toast.kind==='success'?<Check size={20}/>:<X size={20}/>}<span>{toast.text}</span><button className="icon-btn" aria-label="Cerrar notificación" onClick={()=>setToast(null)}><X size={16}/></button></div>}
    {demoOpen&&<Modal title="Conocé Sou Linda con una demo" onClose={()=>{if(!working)setDemoOpen(false);}}><p>Cargaremos productos de lencería con talles y colores, clientas, ventas y gastos ficticios. Podrás borrar la demo desde Datos y respaldos.</p><p className="muted">Esta opción funciona únicamente sobre una base vacía.</p><div className="form-actions"><button className="btn btn-secondary" disabled={working} onClick={()=>setDemoOpen(false)}>Volver</button><button className="btn btn-primary" disabled={working} onClick={loadDemo}>{working?'Cargando…':'Cargar datos de ejemplo'}</button></div></Modal>}
  </div>;
}
