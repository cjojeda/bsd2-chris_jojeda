import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Check, Copy, Download, Minus, Plus, ReceiptText, Save, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { EmptyState, Field, Modal } from '../components/ui';
import { amountInput, localDate, money, cents, basisPoints, roundMoneyRatio, currencyCode, currencySymbol, whatsappPhone } from '../domain/format';
import { clearDraft, loadDraft, recordSale, saveDraft } from '../domain/services';
import { CHANNELS, PAYMENT_METHODS, type Channel, type PaidMethod, type PaymentMethod, type Sale, type SaleDraft, type Snapshot, type Variant } from '../domain/types';

type Props = { data: Snapshot; notify: (message: string, kind?: 'success' | 'error') => void };
type CartLine = { variantId: string; quantity: number; unitPrice: number; priceText?: string };
type PosState = {
  search: string; category: string; size: string; color: string; pricing: 'retail' | 'wholesale'; cart: CartLine[];
  customerId: string; channel: Channel; paymentMethod: PaymentMethod; date: string;
  shipping: string; packaging: string; discount: string; discountKind: 'fixed' | 'percent'; commission: string;
  directCostMethod: PaidMethod; directCostsPaid: boolean; notes: string;
};
type SavedDraft = { format: 'sadi-pos'; version: 2; form: PosState; commandId: string | null; commandSignature: string | null };
type Preview = { subtotal: number; discount: number; discountValue: number; total: number; commission: number; rate: number; shipping: number; packaging: number; cogs: number | null; result: number | null; items: SaleDraft['items']; error: string };
const MAX_CENTS = 9_000_000_000_000_000;
// Share the write barrier across mounts so returning quickly from another screen
// waits for the final edit flushed when the previous POS instance unmounted.
const draftWriteQueue: { current: Promise<void> } = { current: Promise.resolve() };
let activeSaleSettlement: Promise<void> | null = null;
const colors: Record<string, string> = { negro: '#343037', blanco: '#f5f1e9', rojo: '#9b304b', rosa: '#d99fba', nude: '#ceb2a0', azul: '#798da6', bordó: '#823b50', bordo: '#823b50', verde: '#899680', violeta: '#a79ab3' };
const paidMethods = PAYMENT_METHODS.filter((method): method is PaidMethod => method !== 'Crédito');
const initialState = (): PosState => ({ search: '', category: '', size: '', color: '', pricing: 'retail', cart: [], customerId: '', channel: 'Local', paymentMethod: 'Efectivo', date: localDate(), shipping: '0', packaging: '0', discount: '0', discountKind: 'fixed', commission: '0', directCostMethod: 'Efectivo', directCostsPaid: true, notes: '' });
const normalize = (value: string) => value.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function safeNumber(value: bigint, label: string) { if (value < 0n || value > BigInt(MAX_CENTS)) throw new Error(`${label}: el importe supera el límite admitido.`); return Number(value); }
function exactCents(value: string, label: string) { try{return cents(value);}catch(error){throw new Error(`${label}: ${error instanceof Error?error.message:'Ingresá un importe válido.'}`);} }
function bps(value: string, label: string) { try{return basisPoints(value);}catch(error){throw new Error(`${label}: ${error instanceof Error?error.message:'Ingresá un porcentaje válido.'}`);} }
function decodeDraft(value: unknown): SavedDraft | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('El borrador guardado no tiene un formato válido.');
  const draft = value as Partial<SavedDraft>;
  if (draft.format !== 'sadi-pos' || draft.version !== 2 || !draft.form || typeof draft.form !== 'object') throw new Error('Hay un borrador de otra versión. No se reemplazó automáticamente.');
  const form = draft.form;
  for (const key of ['search','category','size','color','customerId','date','shipping','packaging','discount','commission','notes'] as const) if (typeof form[key] !== 'string') throw new Error('El borrador contiene campos incompletos.');
  if (!CHANNELS.includes(form.channel) || !PAYMENT_METHODS.includes(form.paymentMethod) || !paidMethods.includes(form.directCostMethod) || typeof form.directCostsPaid !== 'boolean' || !['retail','wholesale'].includes(form.pricing) || !['fixed','percent'].includes(form.discountKind)) throw new Error('Las opciones del borrador no son válidas.');
  if (!Array.isArray(form.cart) || form.cart.some(line => !line || typeof line.variantId !== 'string' || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0 || (line.priceText !== undefined && typeof line.priceText !== 'string'))) throw new Error('El carrito del borrador no es válido.');
  if (new Set(form.cart.map(line => line.variantId)).size !== form.cart.length) throw new Error('El borrador tiene variantes repetidas.');
  return { format: 'sadi-pos', version: 2, form, commandId: typeof draft.commandId === 'string' ? draft.commandId : null, commandSignature: typeof draft.commandSignature === 'string' ? draft.commandSignature : null };
}
function receiptStatus(sale: Sale) { if (sale.status === 'pending') return 'Pedido pendiente'; if (sale.status === 'reserved') return 'Pedido reservado'; if (sale.status === 'void') return 'Pedido cancelado'; return sale.balance > 0 ? 'Completado · saldo pendiente' : sale.balance < 0 ? 'Completado · crédito a favor' : 'Completado · pagado'; }

export default function PosPage({ data, notify }: Props) {
  const [form, setForm] = useState<PosState>(initialState);
  const [ready, setReady] = useState(false);
  const [draftStatus, setDraftStatus] = useState('Recuperando borrador…');
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [draftIssue, setDraftIssue] = useState('');
  const current = useRef(form); current.current = form;
  const epoch = useRef(0);
  const readyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = draftWriteQueue;
  const hydrationSignature = useRef('');
  const command = useRef<{id: string | null; signature: string | null}>({id:null,signature:null});
  const submitting = useRef(false);
  const htmlForm = useRef<HTMLFormElement>(null);
  const products = useMemo(() => new Map(data.products.map(product => [product.id, product])), [data.products]);
  const variants = useMemo(() => new Map(data.variants.map(variant => [variant.id, variant])), [data.variants]);
  const active = data.variants.filter(variant => variant.active);
  const categories = [...new Set(data.products.map(product => product.category))].sort();
  const sizes = [...new Set(active.map(variant => variant.size))].sort((a,b) => a.localeCompare(b,'es',{numeric:true}));
  const colorOptions = [...new Set(active.map(variant => variant.color))].sort((a,b) => a.localeCompare(b,'es'));
  const filtered = active.filter(variant => {
    const product = products.get(variant.productId);
    return normalize(`${product?.name} ${product?.category} ${variant.sku} ${variant.size} ${variant.color}`).includes(normalize(form.search)) && (!form.category || product?.category === form.category) && (!form.size || variant.size === form.size) && (!form.color || variant.color === form.color);
  });
  function update<K extends keyof PosState>(key: K, value: PosState[K]) { setForm(previous => ({...previous,[key]:value})); }
  function draftPayload(state: PosState): SavedDraft { return {format:'sadi-pos',version:2,form:state,commandId:command.current.id,commandSignature:command.current.signature}; }
  function stopTimer() { if(timer.current){clearTimeout(timer.current);timer.current=null;} }

  useEffect(() => {
    let mounted = true;
    const restore = async () => {
      const generation = ++epoch.current;
      readyRef.current = false;
      stopTimer();
      setReady(false);
      setDraftIssue('');
      setDraftStatus('Recuperando borrador…');
      let recovered = false;
      try {
        // A sale can finish after the user changes screens. Wait for its draft
        // cleanup before showing a fresh POS, avoiding a stale second checkout.
        await activeSaleSettlement;
        await queue.current.catch(() => undefined);
        const saved = decodeDraft(await loadDraft());
        if (!mounted || generation !== epoch.current) return;
        const next = saved?.form ?? initialState();
        command.current = {id:saved?.commandId ?? null,signature:saved?.commandSignature ?? null};
        hydrationSignature.current = JSON.stringify(next);
        current.current = next;
        setForm(next);
        setDraftIssue('');
        setDraftStatus(saved ? 'Borrador recuperado de SQLite' : 'Sin cambios pendientes');
        recovered = true;
      } catch(error) {
        if (!mounted || generation !== epoch.current) return;
        // Preserve the server draft when it cannot be read; no empty autosave replaces it.
        hydrationSignature.current = JSON.stringify(current.current);
        setDraftIssue(error instanceof Error ? error.message : 'No se pudo recuperar el borrador.');
        setDraftStatus('Borrador sin recuperar');
      } finally {
        if(mounted && generation === epoch.current){readyRef.current=recovered;setReady(recovered);}
      }
    };
    const pause = () => {++epoch.current;readyRef.current=false;stopTimer();setReady(false);setDraftStatus('Restaurando la base…');};
    void restore();
    window.addEventListener('sadi:database-replaced',restore);
    window.addEventListener('sadi:database-restored',restore);
    window.addEventListener('sadi:database-restoring',pause);
    window.addEventListener('sadi:database-restore-failed',restore);
    window.addEventListener('sadi:retry-pos-draft',restore);
    const preventUnsavedClose = (event: BeforeUnloadEvent) => {
      if(submitting.current||(readyRef.current&&JSON.stringify(current.current)!==hydrationSignature.current)){event.preventDefault();event.returnValue='';}
    };
    window.addEventListener('beforeunload',preventUnsavedClose);
    return () => {
      // In-app navigation unmounts the page; flush the last debounced edit as well.
      const flush = readyRef.current && !submitting.current && JSON.stringify(current.current)!==hydrationSignature.current;
      const finalPayload = draftPayload(current.current);
      mounted=false;readyRef.current=false;++epoch.current;stopTimer();
      if(flush)queue.current=queue.current.catch(()=>undefined).then(()=>saveDraft(finalPayload)).catch(()=>undefined);
      window.removeEventListener('sadi:database-replaced',restore);window.removeEventListener('sadi:database-restored',restore);window.removeEventListener('sadi:database-restoring',pause);window.removeEventListener('sadi:database-restore-failed',restore);window.removeEventListener('sadi:retry-pos-draft',restore);window.removeEventListener('beforeunload',preventUnsavedClose);
    };
  }, []);

  useEffect(() => {
    if (!ready || !readyRef.current || submitting.current) return;
    const signature = JSON.stringify(form);
    if (signature === hydrationSignature.current) return;
    stopTimer();
    setDraftStatus('Guardando…');
    const generation = epoch.current;
    timer.current = setTimeout(() => {
      timer.current = null;
      if(generation !== epoch.current || !readyRef.current || submitting.current) return;
      const payload = draftPayload(form);
      queue.current = queue.current.catch(() => undefined).then(async () => {
        if(generation !== epoch.current || !readyRef.current) return;
        try {
          await saveDraft(payload);
          if(generation === epoch.current){hydrationSignature.current=signature;setDraftStatus('Borrador guardado en SQLite');setDraftIssue('');}
        } catch(error) {
          if(generation === epoch.current){setDraftStatus('No se pudo guardar');setDraftIssue(error instanceof Error?error.message:'No se pudo guardar el borrador.');}
        }
      });
    },400);
    return stopTimer;
  }, [form,ready]);

  const activeCurrency=currencyCode();
  const preview = useMemo<Preview>(() => {
    try {
      const items = form.cart.map(line => {if(!Number.isSafeInteger(line.quantity)||line.quantity<1)throw new Error('La cantidad debe ser un entero positivo.');return {variantId:line.variantId,quantity:line.quantity,unitPrice:exactCents(line.priceText ?? amountInput(line.unitPrice),'Precio unitario')};});
      const subtotalBig = items.reduce((sum,line) => sum+BigInt(line.quantity)*BigInt(line.unitPrice),0n);
      const subtotal = safeNumber(subtotalBig,'Subtotal');
      const discountValue = form.discountKind === 'percent' ? bps(form.discount,'Descuento') : exactCents(form.discount,'Descuento');
      const applied = form.discountKind === 'percent' ? safeNumber(roundMoneyRatio(subtotalBig*BigInt(discountValue),10_000n),'Descuento') : discountValue;
      if(applied>subtotal)throw new Error('El descuento no puede superar el subtotal.');
      const total=subtotal-applied, rate=bps(form.commission,'Comisión'), shipping=exactCents(form.shipping,'Envío'),packaging=exactCents(form.packaging,'Packaging');
      const commission=safeNumber(roundMoneyRatio(BigInt(total)*BigInt(rate),10_000n),'Comisión');
      let cogsBig=0n;let known=true;
      for(const line of items){const variant=variants.get(line.variantId);if(!variant||variant.stock<1){known=false;continue;}cogsBig+=line.quantity===variant.stock?BigInt(variant.inventoryValue):roundMoneyRatio(BigInt(variant.inventoryValue)*BigInt(line.quantity),BigInt(variant.stock));}
      const cogs=known?safeNumber(cogsBig,'CMV'):null;
      return {subtotal,discount:applied,discountValue,total,commission,rate,shipping,packaging,cogs,result:cogs===null?null:total-cogs-commission-shipping-packaging,items,error:''};
    } catch(error) { return {subtotal:0,discount:0,discountValue:0,total:0,commission:0,rate:0,shipping:0,packaging:0,cogs:null,result:null,items:[],error:error instanceof Error?error.message:'Revisá los importes.'}; }
  },[form,variants,activeCurrency]);
  const unavailable=form.cart.filter(line=>!variants.get(line.variantId)?.active||line.quantity>(variants.get(line.variantId)?.available??0));
  const quantity=form.cart.reduce((sum,line)=>sum+line.quantity,0);
  const blocked=!ready||saving||!form.cart.length||!!preview.error||(form.paymentMethod==='Crédito'&&!form.customerId);

  function add(variant: Variant) {
    const existing=form.cart.find(line=>line.variantId===variant.id);
    if((existing?.quantity??0)>=variant.available){notify('Ya agregaste todas las unidades disponibles.','error');return;}
    update('cart',existing?form.cart.map(line=>line.variantId===variant.id?{...line,quantity:line.quantity+1}:line):[...form.cart,{variantId:variant.id,quantity:1,unitPrice:form.pricing==='retail'?variant.retailPrice:variant.wholesalePrice}]);
  }
  function changePricing(pricing:'retail'|'wholesale') { setForm(previous=>({...previous,pricing,cart:previous.cart.map(line=>{const variant=variants.get(line.variantId);const price=variant?(pricing==='retail'?variant.retailPrice:variant.wholesalePrice):line.unitPrice;return {...line,unitPrice:price,priceText:amountInput(price)};})})); }
  function changeQuantity(variantId:string,quantity:number){if(!Number.isSafeInteger(quantity))return;update('cart',quantity<1?form.cart.filter(line=>line.variantId!==variantId):form.cart.map(line=>line.variantId===variantId?{...line,quantity}:line));}

  async function submit(status: 'pending'|'reserved'|'completed') {
    if(submitting.current||blocked)return;
    if(!htmlForm.current?.reportValidity())return;
    if(status!=='pending'&&unavailable.length){notify('Hay variantes sin disponibilidad suficiente. Revisá el carrito.','error');return;}
    submitting.current=true;setSaving(true);stopTimer();
    let finishSettlement: () => void = () => undefined;
    const settlement = new Promise<void>(resolve => { finishSettlement=resolve; });
    activeSaleSettlement=settlement;
    let savedSale:Sale|null=null;
    try {
      const payload:SaleDraft={date:form.date,customerId:form.customerId||undefined,channel:form.channel,paymentMethod:form.paymentMethod,items:preview.items,shippingCost:preview.shipping,packagingCost:preview.packaging,discount:preview.discount,discountKind:form.discountKind,discountValue:preview.discountValue,commissionRate:preview.rate,status,directCostMethod:form.directCostMethod,directCostsPaid:form.directCostsPaid,notes:form.notes};
      const signature=JSON.stringify(payload);
      if(command.current.signature!==signature||!command.current.id)command.current={id:crypto.randomUUID(),signature};
      payload.commandId=command.current.id!;
      queue.current=queue.current.catch(()=>undefined).then(()=>saveDraft(draftPayload(form)));
      await queue.current;
      savedSale=await recordSale(payload);
      const next=initialState();
      hydrationSignature.current=JSON.stringify(next);
      current.current=next;setForm(next);command.current={id:null,signature:null};
      try{queue.current=queue.current.catch(()=>undefined).then(()=>clearDraft());await queue.current;setDraftStatus('Sin cambios pendientes');setDraftIssue('');}
      catch(error){setDraftIssue('El pedido se guardó, pero no se pudo limpiar el borrador. Revisá Pedidos antes de reintentar.');notify(error instanceof Error?error.message:'No se pudo limpiar el borrador.','error');}
      setReceipt(savedSale);
      notify(status==='reserved'?'Pedido reservado. Solo disminuyó el stock disponible.':status==='pending'?'Pedido pendiente guardado. No se movió stock ni se registró un cobro.':'Venta completada. Stock y finanzas actualizados.');
    }catch(error){notify(error instanceof Error?error.message:'No se pudo registrar el pedido.','error');setDraftStatus(savedSale?'Pedido registrado':'Borrador guardado; operación sin confirmar');}
    finally{submitting.current=false;setSaving(false);if(activeSaleSettlement===settlement)activeSaleSettlement=null;finishSettlement();}
  }
  async function clearCart(){
    if(submitting.current||!window.confirm('¿Vaciar este borrador? No se modifica ningún pedido registrado.'))return;
    submitting.current=true;setSaving(true);++epoch.current;readyRef.current=false;stopTimer();
    try{
      queue.current=queue.current.catch(()=>undefined).then(()=>clearDraft());await queue.current;const next=initialState();hydrationSignature.current=JSON.stringify(next);current.current=next;setForm(next);command.current={id:null,signature:null};setDraftStatus('Sin cambios pendientes');setDraftIssue('');readyRef.current=true;setReady(true);
    }catch(error){notify(error instanceof Error?error.message:'No se pudo vaciar el borrador.','error');readyRef.current=ready;}
    finally{submitting.current=false;setSaving(false);}
  }
  function onSubmit(event:FormEvent){event.preventDefault();void submit('completed');}
  const receiptCustomer=receipt&&data.customers.find(customer=>customer.id===receipt.customerId);
  const receiptText=receipt?['Sou Linda System · Comprobante interno',`${receipt.number} · ${new Date(`${receipt.date}T12:00:00`).toLocaleDateString('es-PY')}`,receiptStatus(receipt),`Moneda: ${currencyCode()}`,`Canal: ${receipt.channel}`,`Clienta: ${receiptCustomer?.name??receipt.customerName??'Venta mostrador'}`,'',...receipt.items.map(item=>`${item.quantity} × ${item.productName}\n${item.variantLabel} · ${money(item.total)}`),'',`Subtotal: ${money(receipt.items.reduce((sum,item)=>sum+item.total,0))}`,`Descuento: ${money(receipt.discount)}`,`TOTAL: ${money(receipt.total)}`,`Cobrado: ${money(receipt.paid)}`,`Saldo: ${money(receipt.balance)}`,`${receipt.status==='completed'?'Medio / condición':'Medio previsto'}: ${receipt.paymentMethod}`,'','Gracias por elegirnos ♡','Comprobante interno · No válido como factura.'].join('\n'):'';
  const phone=whatsappPhone(receiptCustomer?.phone??'');
  function downloadReceipt(){if(!receipt)return;const url=URL.createObjectURL(new Blob([receiptText],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`Sou-Linda-${receipt.number}.txt`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

  return <div className="pos-page">
    <div className="page-heading"><div><p className="eyebrow">HECHO PARA VENDER</p><h1>Nueva venta</h1><p className="page-subtitle">Una compra, unos clics. Reservá o completá sin perder el control.</p></div><span className="badge badge-neutral"><Save size={14}/>{draftStatus}</span></div>
    {draftIssue&&<div className="info-banner" role="status"><span>{draftIssue}{!ready&&' El borrador guardado se conserva hasta que puedas recuperarlo o decidas descartarlo.'}</span>{!ready&&<><button type="button" className="btn btn-secondary btn-small" disabled={saving} onClick={()=>window.dispatchEvent(new Event('sadi:retry-pos-draft'))}>Reintentar</button><button type="button" className="btn btn-ghost btn-small danger-text" disabled={saving} onClick={()=>void clearCart()}>Descartar borrador</button></>}</div>}
    <div className="pos-layout"><section className="pos-catalog"><div className="panel pos-filters"><label className="search-box"><Search size={18}/><input className="search-input" aria-label="Buscar producto para vender" placeholder="Buscar modelo, código o color…" value={form.search} onChange={event=>update('search',event.target.value)} disabled={!ready||saving}/></label><div className="toolbar"><select aria-label="Categoría de productos" value={form.category} onChange={event=>update('category',event.target.value)} disabled={!ready||saving}><option value="">Todas las categorías</option>{categories.map(value=><option key={value}>{value}</option>)}</select><select aria-label="Talle de productos" value={form.size} onChange={event=>update('size',event.target.value)} disabled={!ready||saving}><option value="">Todos los talles</option>{sizes.map(value=><option key={value}>{value}</option>)}</select><select aria-label="Color de productos" value={form.color} onChange={event=>update('color',event.target.value)} disabled={!ready||saving}><option value="">Todos los colores</option>{colorOptions.map(value=><option key={value}>{value}</option>)}</select></div></div>
      <div className="catalog-heading"><span className="muted">{filtered.length} variantes · stock disponible</span><div className="segmented"><button disabled={!ready||saving} className={form.pricing==='retail'?'active':''} onClick={()=>changePricing('retail')}>Minorista</button><button disabled={!ready||saving} className={form.pricing==='wholesale'?'active':''} onClick={()=>changePricing('wholesale')}>Mayorista</button></div></div>
      {filtered.length?<div className="product-grid">{filtered.map(variant=>{const product=products.get(variant.productId);const inCart=form.cart.find(line=>line.variantId===variant.id)?.quantity??0;return <button key={variant.id} className="catalog-card" onClick={()=>add(variant)} disabled={!ready||saving||variant.available<=inCart} aria-label={`Agregar ${product?.name} talle ${variant.size} ${variant.color}`}><div className="catalog-art" style={{'--swatch':colors[normalize(variant.color)]??'#b2a0a6'} as CSSProperties}><ShoppingBag size={36} strokeWidth={1.1}/><span className="catalog-stock">{variant.available===0?'Sin disponibilidad':`${variant.available-inCart} disponibles`}</span></div><div className="catalog-card-body"><small className="muted">{product?.category}</small><strong>{product?.name}</strong><span className="variant-description">Talle {variant.size}<span>·</span><i className="color-dot" style={{background:colors[normalize(variant.color)]??'#b2a0a6'}}/>{variant.color}</span><small className="muted">Físico {variant.stock} · Reservado {variant.reserved}</small><div className="catalog-price"><strong>{money(form.pricing==='retail'?variant.retailPrice:variant.wholesalePrice)}</strong><span className="add-circle"><Plus size={17}/></span></div></div></button>;})}</div>:<div className="panel"><EmptyState title={active.length?'Probá con otra búsqueda':'Prepará tu primera venta'} detail={active.length?'Cambiá los filtros para encontrar el talle y color que buscás.':'Agregá productos desde Inventario para verlos acá.'}/></div>}
    </section><form ref={htmlForm} className="panel pos-checkout" onSubmit={onSubmit}><div className="panel-head"><div><h2>Detalle del pedido</h2><p>{quantity} {quantity===1?'prenda seleccionada':'prendas seleccionadas'}</p></div><ReceiptText size={22}/></div><div className="cart-lines">{form.cart.length?form.cart.map(line=>{const variant=variants.get(line.variantId);return <div className="cart-line" key={line.variantId}><div><strong>{variant?products.get(variant.productId)?.name:'Variante sin encontrar'}</strong><small>Talle {variant?.size??'—'} · {variant?.color??'—'}</small><div className="quantity-control"><button type="button" aria-label={`Quitar una unidad de ${variant?.sku??'variante'}`} onClick={()=>changeQuantity(line.variantId,line.quantity-1)} disabled={saving||!ready}><Minus size={13}/></button><span>{line.quantity}</span><button type="button" aria-label={`Agregar una unidad de ${variant?.sku??'variante'}`} onClick={()=>changeQuantity(line.variantId,line.quantity+1)} disabled={saving||!ready||line.quantity>=(variant?.available??0)}><Plus size={13}/></button></div><label className="pos-unit-price"><span>Precio unitario ({currencySymbol()})</span><input aria-label={`Precio unitario de ${variant?.sku??'variante'}`} inputMode="decimal" value={line.priceText??amountInput(line.unitPrice)} onChange={event=>update('cart',form.cart.map(item=>item.variantId===line.variantId?{...item,priceText:event.target.value}:item))} disabled={saving||!ready} required/></label></div><div className="cart-line-total"><strong>{money(preview.items.find(item=>item.variantId===line.variantId)?.unitPrice!==undefined?preview.items.find(item=>item.variantId===line.variantId)!.unitPrice*line.quantity:line.unitPrice*line.quantity)}</strong><button type="button" className="icon-btn" aria-label={`Eliminar ${variant?.sku??'variante'} de la venta`} onClick={()=>update('cart',form.cart.filter(item=>item.variantId!==line.variantId))} disabled={saving||!ready}><Trash2 size={15}/></button></div></div>;}):<div className="empty-cart"><ShoppingBag size={28} strokeWidth={1.2}/><p>Elegí una prenda para empezar</p></div>}</div>
      <fieldset className="pos-input-fields" disabled={!ready||saving}><div className="checkout-fields"><Field label="Clienta"><select value={form.customerId} onChange={event=>update('customerId',event.target.value)} required={form.paymentMethod==='Crédito'}><option value="">Venta mostrador / sin identificar</option>{data.customers.map(customer=><option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></Field><div className="form-grid"><Field label="Canal de venta"><select value={form.channel} onChange={event=>update('channel',event.target.value as Channel)}>{CHANNELS.map(value=><option key={value}>{value}</option>)}</select></Field><Field label="Cobro al completar"><select value={form.paymentMethod} onChange={event=>update('paymentMethod',event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(value=><option value={value} key={value}>{value==='Crédito'?'Fiado / Crédito':value}</option>)}</select></Field></div><Field label="Fecha del pedido"><input type="date" required value={form.date} onChange={event=>update('date',event.target.value)}/></Field><p className="inline-note">{form.paymentMethod==='Crédito'?'Fiado: se completa sin registrar dinero cobrado. Requiere una clienta; los cobros se gestionan desde Pedidos.':'Completar registra el cobro pendiente. Guardar o reservar no cobra automáticamente.'}</p><details className="pos-cost-details"><summary>Promoción, comisión y costos directos</summary><div className="form-grid"><Field label="Tipo de descuento"><select value={form.discountKind} onChange={event=>update('discountKind',event.target.value as 'fixed'|'percent')}><option value="fixed">Importe fijo ({currencySymbol()})</option><option value="percent">Porcentaje (%)</option></select></Field><Field label={form.discountKind==='percent'?'Descuento (%)':`Descuento (${currencySymbol()})`}><input inputMode="decimal" required value={form.discount} onChange={event=>update('discount',event.target.value)}/></Field><Field label="Comisión del cobro (%)"><input inputMode="decimal" required value={form.commission} onChange={event=>update('commission',event.target.value)}/></Field><Field label={`Packaging (${currencySymbol()})`}><input inputMode="decimal" required value={form.packaging} onChange={event=>update('packaging',event.target.value)}/></Field><Field label={`Envío asumido (${currencySymbol()})`}><input inputMode="decimal" required value={form.shipping} onChange={event=>update('shipping',event.target.value)}/></Field><Field label="Medio para envío y packaging"><select value={form.directCostMethod} onChange={event=>update('directCostMethod',event.target.value as PaidMethod)} disabled={!form.directCostsPaid}>{paidMethods.map(method=><option key={method}>{method}</option>)}</select></Field></div><label className="stock-filter pos-paid-checkbox"><input type="checkbox" checked={form.directCostsPaid} onChange={event=>update('directCostsPaid',event.target.checked)}/>Envío y packaging se pagan al completar</label><p className="inline-note">Estos costos reducen la ganancia una sola vez. Si quedan pendientes, su pago se registra después. La comisión se aplica a cada cobro efectivo.</p></details><Field label="Nota interna (opcional)"><input maxLength={2000} value={form.notes} onChange={event=>update('notes',event.target.value)} placeholder="Referencia o indicación de entrega"/></Field></div></fieldset>
      <div className="sale-totals"><div><span>Subtotal</span><span>{money(preview.subtotal)}</span></div><div><span>Descuento</span><span>−{money(preview.discount)}</span></div><div className="checkout-total"><strong>Total a cobrar</strong><strong>{money(preview.total)}</strong></div><div><span>CMV estimado por CPP</span><span>{money(preview.cogs)}</span></div><div><span>Comisión estimada</span><span>{money(preview.commission)}</span></div><div><span>Envío + packaging</span><span>{money(preview.shipping+preview.packaging)}</span></div><div className="contribution"><span>Resultado estimado*</span><span>{money(preview.result)}</span></div><small className="muted">* Antes de gastos operativos. El costo definitivo se fija al completar, no al reservar.</small>{preview.error&&<p role="alert" className="danger-text">{preview.error}</p>}{unavailable.length>0&&<p role="status" className="danger-text">Hay variantes sin disponibilidad suficiente para reservar o completar.</p>}</div><div className="pos-secondary-actions"><button type="button" className="btn btn-secondary" disabled={blocked} onClick={()=>void submit('pending')}>Guardar pendiente</button><button type="button" className="btn btn-secondary" disabled={blocked||!!unavailable.length} onClick={()=>void submit('reserved')}>Reservar stock</button></div><button className="btn btn-primary checkout-submit" disabled={blocked||!!unavailable.length}>{saving?'Registrando…':<><Check size={18}/>Completar venta</>}</button><button className="btn btn-ghost pos-clear-draft" type="button" disabled={saving||!ready||!form.cart.length} onClick={()=>void clearCart()}>Vaciar borrador</button>
    </form></div>
    {receipt&&<Modal title={receipt.status==='completed'?'Venta registrada':'Pedido guardado'} onClose={()=>setReceipt(null)}><div className="receipt-success"><Check size={26}/><div><h3>{receiptStatus(receipt)}</h3><p className="muted">{receipt.status==='reserved'?'La reserva redujo disponibilidad, sin reconocer una venta ni un cobro.':receipt.status==='pending'?'El pedido todavía no reserva stock ni registra cobros.':'El costo quedó fijado y el inventario actualizado.'}</p></div></div><pre className="receipt-preview">{receiptText}</pre><div className="form-actions"><button className="btn btn-secondary" onClick={async()=>{try{await navigator.clipboard.writeText(receiptText);notify('Comprobante copiado.');}catch{notify('Seleccioná y copiá el texto del comprobante.','error');}}}><Copy size={16}/>Copiar</button><button className="btn btn-secondary" onClick={downloadReceipt}><Download size={16}/>.txt</button><a className="btn btn-primary" href={`https://wa.me/${phone}?text=${encodeURIComponent(receiptText)}`} target="_blank" rel="noopener noreferrer">Preparar WhatsApp</a></div><p className="inline-note">WhatsApp necesita conexión y tu confirmación para enviar el mensaje.</p></Modal>}
  </div>;
}
