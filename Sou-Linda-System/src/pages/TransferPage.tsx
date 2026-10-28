import { useRef, useState } from 'react';
import { ArchiveRestore, ArrowDownToLine, CheckCircle2, Database, Download, FileSpreadsheet, HardDrive, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { Field, Modal } from '../components/ui';
import type { Snapshot } from '../domain/types';
import { currencyCode, currencySymbol } from '../domain/format';
import { clearDemoData, commitImport, downloadBackup, downloadSQLiteBackup, downloadTemplate, exportTable, previewImport, readImportFile, restoreBackup, validateBackup, REQUIRED_HEADERS, SALE_HEADERS, VARIANT_HEADERS, type ExportKind, type ImportKind, type ImportPreview, type InspectedFile } from '../data/transfer';

type Props = {data:Snapshot;notify:(message:string,kind?:'success'|'error')=>void};
const problem = (error:unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.';
const normalize = (value:string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('es');
const FIELD_NAMES: Record<string,string> = {modelo:'Nombre / modelo',categoria:'Categoría',sku:'SKU',talle:'Talle',color:'Color',costo:'Costo unitario (ARS)',pvp:'Precio minorista (ARS)',mayorista:'Precio mayorista (ARS)',stock:'Stock físico inicial',stock_minimo:'Stock mínimo',id_externo:'ID de venta de origen',fecha:'Fecha de venta',cantidad:'Cantidad',precio_unitario:'Precio vendido por unidad',costo_unitario:'Costo histórico por unidad',canal:'Canal de venta',medio_pago:'Medio de cobro / Crédito',envio:'Envío del pedido (ARS)',packaging:'Packaging del pedido (ARS)',descuento:'Descuento fijo del pedido (ARS)',comision_porcentaje:'Comisión (%)',cliente:'Nombre de clienta',cliente_id:'ID de clienta existente',fecha_cobro:'Fecha de cobro'};

export default function TransferPage({data,notify}:Props) {
  const [busy,setBusy] = useState(false);
  const [importKind,setImportKind] = useState<ImportKind>('variants');
  const [exportKind,setExportKind] = useState<ExportKind>('variants');
  const [format,setFormat] = useState<'csv'|'xlsx'>('xlsx');
  const [sourceAccount,setSourceAccount] = useState('principal');
  const [file,setFile] = useState<InspectedFile|null>(null);
  const [mapping,setMapping] = useState<Record<string,string>>({});
  const [mappingOpen,setMappingOpen] = useState(false);
  const [preview,setPreview] = useState<ImportPreview|null>(null);
  const [acknowledge,setAcknowledge] = useState(false);
  const [restore,setRestore] = useState<{content:string;summary:string;currency:'PYG'|'ARS'}|null>(null);
  const [resetDemo,setResetDemo] = useState(false);
  const [resetConfirmation,setResetConfirmation] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const lastBackup = data.settings.find(row=>row.key==='last_backup_at')?.value;
  const lastBackupDate = lastBackup && Number.isFinite(Date.parse(lastBackup)) ? new Date(lastBackup).toLocaleString('es-PY') : null;

  async function run(action:()=>Promise<void>,success?:string) {
    setBusy(true);
    try {await action();if(success)notify(success);} catch(error){notify(problem(error),'error');} finally {setBusy(false);}
  }
  async function loadImport(selected:File) {
    await run(async()=>{
      setPreview(null);setAcknowledge(false);
      const inspected = await readImportFile(selected);
      setFile(inspected);
      const fields = importKind==='variants'?VARIANT_HEADERS:SALE_HEADERS;
      setMapping(Object.fromEntries(fields.map(field=>[field,inspected.headers.find(header=>normalize(header)===normalize(field))??''])));
      setMappingOpen(true);
    });
  }
  async function makePreview() {
    if(!file)return;
    await run(async()=>{setPreview(await previewImport(file,importKind,mapping,sourceAccount));setAcknowledge(false);setMappingOpen(false);});
  }
  async function loadBackup(selected:File) {
    await run(async()=>{
      if(selected.size>50*1024*1024)throw new Error('El respaldo supera 50 MB.');
      const content=await selected.text();
      const result=await validateBackup(content);
      setRestore({content,currency:result.currency,summary:`${result.counts.products??0} modelos, ${result.counts.variants??0} variantes, ${result.counts.orders??0} pedidos y ${result.counts.customers??0} clientas.`});
    });
  }
  return <>
    <div className="page-heading"><div><p className="eyebrow">EL NEGOCIO QUEDA EN TU NOTEBOOK</p><h1>Tus datos, siempre tuyos<span className="heading-dot">.</span></h1><p className="page-subtitle">La base SQLite está en la notebook. El navegador muestra y administra esos mismos datos.</p></div><span className="badge badge-success"><HardDrive size={14}/>SQLite local</span></div>
    <div className="grid-2">
      <section className="panel backup-card"><div className="panel-head"><div className="transfer-icon"><Database size={24}/></div><span className="badge badge-neutral">Respaldo completo</span></div><h2>Un clic para estar tranquila</h2><p>Descargá inventario, clientas, pedidos, cobros, gastos, movimientos, borradores y cierres en un único archivo JSON.</p><div className="toolbar"><button className="btn btn-primary" disabled={busy} onClick={()=>run(downloadBackup,'Respaldo generado. Revisá la carpeta Descargas.')}><Download size={16}/>Descargar respaldo JSON</button><button className="btn btn-secondary" disabled={busy} onClick={()=>run(downloadSQLiteBackup,'Copia SQLite generada. Revisá Descargas.')}><Database size={16}/>Copia SQLite</button></div><p className="transfer-small">{lastBackupDate?`Última descarga iniciada: ${lastBackupDate}.`:'Todavía no generaste una copia manual.'} Conservá una copia en otra unidad o en tu carpeta de respaldo.</p></section>
      <section className="panel backup-card"><div className="panel-head"><div className="transfer-icon neutral"><ArchiveRestore size={24}/></div><span className="badge badge-neutral">Recuperación</span></div><h2>Restaurar una copia</h2><p>El servidor valida referencias, importes, stock y libros de caja antes de reemplazar los datos. Una falla conserva la base anterior.</p><button className="btn btn-secondary" disabled={busy} onClick={()=>restoreInput.current?.click()}><Upload size={16}/>Elegir respaldo JSON</button><input hidden ref={restoreInput} type="file" accept=".json,application/json" onChange={e=>{const selected=e.target.files?.[0];e.target.value='';if(selected)void loadBackup(selected);}}/><p className="transfer-small">La restauración reemplaza la base completa. Se genera automáticamente un respaldo previo en la carpeta backups de la notebook.</p></section>
    </div>
    <section className="panel transfer-import"><div className="panel-head"><div><h2>Migrá tus datos desde Treinta o Excel</h2><p>Relacioná tus encabezados con los campos Sou Linda y revisá el resultado antes de guardar.</p></div><FileSpreadsheet size={23} className="muted"/></div>
      <div className="form-grid"><Field label="Contenido del archivo"><select value={importKind} disabled={busy} onChange={e=>{setImportKind(e.target.value as ImportKind);setPreview(null);setFile(null);}}><option value="variants">Catálogo y stock inicial</option><option value="sales">Ventas históricas</option></select></Field><Field label="Cuenta de origen" hint="Conservá este nombre para la misma cuenta: evita repetir ventas entre archivos."><input value={sourceAccount} disabled={busy} maxLength={160} onChange={e=>{setSourceAccount(e.target.value);setPreview(null);}} placeholder="principal"/></Field></div>
      <div className="toolbar"><button className="btn btn-secondary" disabled={busy} onClick={()=>run(()=>downloadTemplate(importKind),'Plantilla descargada.')}><ArrowDownToLine size={16}/>Descargar plantilla CSV</button><button className="btn btn-primary" disabled={busy} onClick={()=>importInput.current?.click()}><Upload size={16}/>{busy?'Procesando…':'Elegir CSV o Excel'}</button>{file&&<button className="btn btn-ghost" disabled={busy} onClick={()=>setMappingOpen(true)}>Revisar mapeo de columnas</button>}</div>
      <input hidden ref={importInput} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e=>{const selected=e.target.files?.[0];e.target.value='';if(selected)void loadImport(selected);}}/>
      <div className="transfer-note"><ShieldCheck size={18}/><p>Archivos de hasta 10 MB y 20.000 filas. CSV UTF-8 con coma, punto y coma o tabulación; también .xlsx. {currencyCode()==='PYG'?'Usá guaraníes enteros, por ejemplo 50000 o 50.000, sin decimales. Los porcentajes pueden usar 1,25.':'Usá importes como 1250,50 sin separador de miles.'} Fechas AAAA-MM-DD o DD/MM/AAAA. Las fórmulas de Excel deben convertirse a valores.</p></div>
      {importKind==='sales'&&<div className="transfer-note"><p><strong>Una venta puede tener varios artículos.</strong> Las filas con el mismo ID externo forman un solo pedido. Descuento, envío y packaging deben repetirse iguales en esas filas y se contabilizan una sola vez. El historial no descuenta tu stock actual. Si falta el costo histórico, la ganancia se muestra incompleta; nunca se supone costo cero. Un medio distinto de Crédito representa un cobro efectivo que debés conciliar; el fiado requiere clienta.</p></div>}
      {preview&&<div className="import-preview"><div className="panel-head"><div><h3>{file?.fileName}</h3><p>{preview.rowCount} filas → {preview.documentCount} {importKind==='variants'?'variantes':'pedidos'} · {preview.errors.length} errores</p></div><span className={`badge ${preview.ready?'badge-success':'badge-warning'}`}>{preview.ready?'Vista previa validada':'Requiere correcciones'}</span></div>
        {preview.errors.length>0&&<div className="import-errors" role="alert"><p><strong>No se guardó ningún dato.</strong></p><ul>{preview.errors.slice(0,50).map((error,index)=><li key={index}>{error}</li>)}</ul>{preview.errors.length>50&&<p>Hay {preview.errors.length-50} errores adicionales.</p>}</div>}
        {preview.warnings.length>0&&<div className="transfer-note"><ul>{preview.warnings.slice(0,30).map((warning,index)=><li key={index}>{warning}</li>)}</ul></div>}
        <div className="table-wrap"><table><thead><tr>{preview.headers.map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{preview.rows.map((row,index)=><tr key={index}>{preview.headers.map(header=><td key={header}>{row[header]}</td>)}</tr>)}</tbody></table></div><p className="transfer-small">Se muestran las primeras 5 filas. La vista previa vence a los 30 minutos.</p>
        {preview.warnings.length>0&&<label className="stock-filter"><input type="checkbox" checked={acknowledge} onChange={e=>setAcknowledge(e.target.checked)}/>Revisé costos, cobros y advertencias de esta importación.</label>}
        <button className="btn btn-primary" disabled={busy||!preview.ready||(preview.warnings.length>0&&!acknowledge)} onClick={()=>run(async()=>{const result=await commitImport(preview,acknowledge);setPreview(null);setFile(null);notify(`Importación completa: ${result.count} documentos guardados.`);})}><CheckCircle2 size={16}/>Confirmar importación</button>
      </div>}
    </section>
    <section className="panel transfer-import"><div className="panel-head"><div><h2>Llevá tus números a Excel</h2><p>Exportaciones para revisar y analizar; el JSON completo sirve para recuperar la base.</p></div><FileSpreadsheet size={23}/></div><div className="form-grid"><Field label="Datos"><select value={exportKind} onChange={e=>setExportKind(e.target.value as ExportKind)}><option value="variants">Variantes e inventario</option><option value="sales">Detalle de pedidos y ventas</option><option value="expenses">Gastos operativos</option></select></Field><Field label="Formato"><select value={format} onChange={e=>setFormat(e.target.value as 'csv'|'xlsx')}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV compatible con Excel</option></select></Field></div><button className="btn btn-secondary" disabled={busy} onClick={()=>run(()=>exportTable(exportKind,format),'Exportación generada. Revisá Descargas.')}><Download size={16}/>Exportar tabla</button><p className="transfer-small">En el detalle de ventas, los costos y saldos del pedido se muestran solamente en la primera línea. Los importes de Excel son numéricos; no sumes el precio unitario como si fuera un total.</p></section>
    <div className="transfer-note"><HardDrive size={19}/><p>La base y las copias automáticas locales permanecen en la notebook, incluso si cambiás de navegador. Una pérdida del disco también puede perder esas copias: descargá respaldos externos periódicos. El acceso móvil a reportes es de solo lectura y no permite importar, restaurar ni descargar la base.</p></div>
    {data.settings.some(row=>row.key==='demo'&&row.value==='true')&&<section className="panel backup-card"><div className="panel-head"><div><h2>Empezar con tus datos reales</h2><p>Vaciar exclusivamente una base marcada como demostración.</p></div><span className="badge badge-warning">Datos de ejemplo</span></div><p>Esto borra todos los registros, incluidos los que hayas agregado después de la demo. Se conserva una copia previa en la notebook.</p><button className="btn btn-secondary" disabled={busy} onClick={()=>{setResetConfirmation('');setResetDemo(true);}}><Trash2 size={16}/>Vaciar base de demostración</button></section>}
    {mappingOpen&&file&&<Modal title="Relacioná las columnas de tu archivo" wide onClose={()=>{if(!busy)setMappingOpen(false);}}><p className="muted">{file.fileName} · {file.rowCount} filas. Los campos con * son obligatorios. Elegir columnas todavía no guarda datos.</p><div className="form-grid">{(importKind==='variants'?VARIANT_HEADERS:SALE_HEADERS).map(field=><Field key={field} label={`${(FIELD_NAMES[field]??field).replaceAll('(ARS)',`(${currencySymbol()})`)}${REQUIRED_HEADERS[importKind].includes(field)?' *':''}`}><select value={mapping[field]??''} disabled={busy} onChange={e=>setMapping(current=>({...current,[field]:e.target.value}))}><option value="">— No importar / vacío —</option>{file.headers.map(header=><option key={header} value={header}>{header}</option>)}</select></Field>)}</div><div className="form-actions"><button className="btn btn-secondary" disabled={busy} onClick={()=>setMappingOpen(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy||!sourceAccount.trim()} onClick={()=>void makePreview()}>Generar vista previa</button></div></Modal>}
    {restore&&<Modal title="¿Reemplazar todos los datos?" onClose={()=>{if(!busy)setRestore(null);}}><p>El respaldo contiene {restore.summary}</p><p>Moneda del respaldo: <strong>{restore.currency==='PYG'?'PYG · Guaraníes':'ARS · Pesos argentinos (base anterior)'}</strong>.</p>{restore.currency!==currencyCode()&&<p className="report-warning">La moneda del respaldo es diferente. Restaurarlo conserva sus importes y su moneda originales; no aplica un tipo de cambio ni los convierte a guaraníes.</p>}<p>Se reemplazarán pedidos, catálogo, cobros, gastos, movimientos y borradores. El servidor guardará una copia previa antes de comenzar; también podés descargarla ahora.</p><div className="form-actions"><button className="btn btn-secondary" disabled={busy} onClick={()=>run(downloadBackup,'Respaldo actual descargado.')}><Download size={16}/>Respaldar ahora</button><button className="btn btn-ghost" disabled={busy} onClick={()=>setRestore(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={()=>run(async()=>{await restoreBackup(restore.content,true);setRestore(null);setPreview(null);setFile(null);},'Base restaurada y validada.')}>Sí, reemplazar datos</button></div></Modal>}
    {resetDemo&&<Modal title="Vaciar la base de demostración" onClose={()=>{if(!busy)setResetDemo(false);}}><p>Se eliminarán todos los modelos, variantes, clientas, pedidos, cobros, gastos, movimientos y cierres. Incluye los registros agregados después de la demo.</p><button className="btn btn-secondary" disabled={busy} onClick={()=>run(downloadBackup,'Respaldo descargado.')}><Download size={16}/>Descargar respaldo antes de borrar</button><Field label="Escribí ELIMINAR para confirmar"><input value={resetConfirmation} onChange={e=>setResetConfirmation(e.target.value)} autoComplete="off"/></Field><div className="form-actions"><button className="btn btn-ghost" disabled={busy} onClick={()=>setResetDemo(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy||resetConfirmation!=='ELIMINAR'} onClick={()=>run(async()=>{await clearDemoData(resetConfirmation);setResetDemo(false);setPreview(null);setFile(null);},'Base vacía. Ya podés cargar tus datos reales.')}><Trash2 size={16}/>Eliminar todos los datos</button></div></Modal>}
  </>;
}
