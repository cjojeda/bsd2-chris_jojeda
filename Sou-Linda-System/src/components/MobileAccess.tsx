import { useEffect, useState } from 'react';
import { Smartphone, Link, ShieldCheck, Unplug, Copy } from 'lucide-react';
import { api, mutate } from '../data/api';

type Config = {enabled:boolean;paired:boolean;reportAddresses:string[]};
type Pairing = {enabled:boolean;paired:boolean;token:string;urls:string[];qrSvg:string|null};

export default function MobileAccess({notify}:{notify:(message:string,kind?:'success'|'error')=>void}) {
  const [config,setConfig]=useState<Config|null>(null);
  const [pairing,setPairing]=useState<Pairing|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;api<Config>('/mobile/config').then(value=>{if(active)setConfig(value);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'No se pudo consultar el acceso móvil.');});return()=>{active=false;};},[]);
  const pair=async()=>{setBusy(true);setError('');try{const result=await mutate<Pairing>('/mobile/pair',{});setPairing(result);setConfig(value=>value?{...value,paired:true}:value);notify('Nuevo enlace creado. Los enlaces anteriores dejaron de funcionar.');}catch(e){setError(e instanceof Error?e.message:'No se pudo vincular el celular.');}finally{setBusy(false);}};
  const revoke=async()=>{setBusy(true);try{await mutate('/mobile/revoke',{});setPairing(null);setConfig(value=>value?{...value,paired:false}:value);notify('Acceso móvil revocado.');}catch(e){notify(e instanceof Error?e.message:'No se pudo revocar el acceso.','error');}finally{setBusy(false);}};
  const copy=async(url:string)=>{try{await navigator.clipboard.writeText(url);notify('Enlace copiado. Abrilo en Chrome del celular.');}catch{notify('No se pudo copiar. Seleccioná el enlace y copialo manualmente.','error');}};
  return <section className="panel mobile-access-panel" aria-labelledby="mobile-access-title">
    <div className="panel-head"><div><p className="eyebrow">TU NEGOCIO, A MANO</p><h2 id="mobile-access-title"><Smartphone size={19}/> Reportes en tu celular</h2><p>Solo lectura · Misma red Wi-Fi · Notebook encendida</p></div><ShieldCheck size={22}/></div>
    <div className="mobile-access-body">
      <p>Consultá ventas, costos y rentabilidad desde Chrome en el celular. La base de datos sigue guardada en esta notebook.</p>
      {error&&<p className="report-error" role="alert">{error}</p>}
      {!config&&!error&&<p role="status">Consultando configuración…</p>}
      {config&&!config.enabled&&<div className="mobile-access-empty"><strong>Activá el acceso desde la notebook</strong><p>Cerrá el motor local y abrí <b>Compartir-reportes-en-celular.cmd</b>. Después volvé a esta pantalla para generar el enlace.</p></div>}
      {config?.enabled&&<>
        {!config.reportAddresses.length&&<p className="report-warning">No se detectó una dirección de la red local. Conectá la notebook al Wi-Fi y reiniciá el motor con acceso móvil.</p>}
        <div className="mobile-access-actions"><button className="btn btn-primary" disabled={busy||!config.reportAddresses.length} onClick={pair}><Link size={16}/>{busy?'Procesando…':config.paired?'Generar un nuevo enlace':'Vincular celular'}</button>{config.paired&&<button className="btn btn-secondary" disabled={busy} onClick={revoke}><Unplug size={16}/>Revocar acceso</button>}</div>
        {config.paired&&!pairing&&<p className="muted">Ya hay un enlace activo. Por seguridad, solo se muestra cuando lo generás. Podés reemplazarlo para vincular otro celular.</p>}
      </>}
      {pairing&&<div className="mobile-pairing">
        {pairing.qrSvg&&pairing.urls.length>0&&<img className="mobile-qr" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pairing.qrSvg)}`} alt="Código QR para abrir los reportes en tu celular"/>}
        <div><h3>Escaneá el QR con el celular</h3><p>Si hay varias direcciones, usá la de tu conexión Wi-Fi. El enlace permite ver los reportes; compartilo solo con quien tenga autorización.</p>{pairing.urls.map(url=><div className="mobile-pairing-url" key={url}><input aria-label="Enlace privado de reportes" value={url} readOnly onFocus={event=>event.target.select()}/><button className="icon-btn" aria-label="Copiar enlace privado" onClick={()=>copy(url)}><Copy size={18}/></button></div>)}<p className="muted">Este enlace no da acceso a ventas, clientas ni cambios en el inventario. Revocar el acceso lo invalida de inmediato. Usá una red de confianza.</p></div>
      </div>}
    </div>
  </section>;
}
