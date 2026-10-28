import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpRight, Grid2X2, List, Minus, Package, Pencil, Plus, Search } from 'lucide-react';
import { EmptyState, Field, Modal } from '../components/ui';
import { amountInput, localDate, money } from '../domain/format';
import { adjustStock, listPurchases, payPurchase, receiveStock, saveVariant, type Purchase } from '../domain/services';
import { PAYMENT_METHODS, type PaidMethod, type Snapshot, type Variant } from '../domain/types';

type Props = { data: Snapshot; notify: (message: string, kind?: 'success' | 'error') => void };
type VariantForm = { variantId?: string; productId: string; name: string; category: string; sku: string; size: string; color: string; cost: string; retailPrice: string; wholesalePrice: string; stock: string; minStock: string };
type ReceiptForm = { variantId: string; quantity: string; totalCost: string; note: string; date: string; paid: boolean; paymentMethod: PaidMethod; commandId: string };
type LossForm = { variantId: string; quantity: string; note: string; date: string; confirmed: boolean; commandId: string };
type PurchasePaymentForm = { purchase: Purchase; date: string; method: PaidMethod; confirmed: boolean };
const paidMethods = PAYMENT_METHODS.filter((method): method is PaidMethod => method !== 'Crédito');
const normalize = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
const naturalSort = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
function count(value: string, label: string, minimum = 0) {
  if (!/^\d+$/.test(value)) throw new Error(`${label}: ingresá una cantidad entera.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new Error(`${label}: ingresá un entero ${minimum ? 'mayor que cero' : 'sin negativos'}.`);
  return result;
}
function amount(value: string, label: string) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error(`${label}: usá un importe como 1250,50, sin separadores de miles.`);
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > 9_000_000_000_000_000n) throw new Error(`${label}: el importe supera el límite admitido.`);
  return Number(result);
}
function roundedRatio(value: number, units: number) {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(units) || units <= 0) return null;
  const denominator = BigInt(units);
  return Number((2n * BigInt(value) + denominator) / (2n * denominator));
}

export default function InventoryPage({ data, notify }: Props) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [view, setView] = useState<'list' | 'matrix'>('list');
  const [matrixProductId, setMatrixProductId] = useState('');
  const [form, setForm] = useState<VariantForm | null>(null);
  const [receipt, setReceipt] = useState<ReceiptForm | null>(null);
  const [loss, setLoss] = useState<LossForm | null>(null);
  const [selected, setSelected] = useState<Variant | null>(null);
  const [saving, setSaving] = useState(false);
  const [purchaseHistoryOpen, setPurchaseHistoryOpen] = useState(false);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState('');
  const [purchasePayment, setPurchasePayment] = useState<PurchasePaymentForm | null>(null);
  const submitting = useRef(false);
  const products = useMemo(() => new Map(data.products.map(product => [product.id, product])), [data.products]);
  const active = data.variants.filter(variant => variant.active);
  const low = active.filter(variant => variant.available <= variant.minStock);
  const categories = [...new Set(data.products.map(product => product.category))].sort(naturalSort);
  const sizes = [...new Set(active.map(variant => variant.size))].sort(naturalSort);
  const colors = [...new Set(active.map(variant => variant.color))].sort(naturalSort);
  const filtered = active.filter(variant => {
    const product = products.get(variant.productId);
    return normalize(`${product?.name ?? ''} ${product?.category ?? ''} ${variant.sku} ${variant.size} ${variant.color}`).includes(normalize(search))
      && (!category || product?.category === category)
      && (!size || variant.size === size)
      && (!color || variant.color === color)
      && (!lowOnly || variant.available <= variant.minStock);
  });
  const filteredProducts = data.products.filter(product => filtered.some(variant => variant.productId === product.id)).sort((a, b) => naturalSort(a.name, b.name));
  const effectiveMatrixId = filteredProducts.some(product => product.id === matrixProductId) ? matrixProductId : filteredProducts[0]?.id ?? '';
  const matrixVariants = filtered.filter(variant => variant.productId === effectiveMatrixId);
  const matrixSizes = [...new Set(matrixVariants.map(variant => variant.size))].sort(naturalSort);
  const matrixColors = [...new Set(matrixVariants.map(variant => variant.color))].sort(naturalSort);
  const matrixCells = new Map(matrixVariants.map(variant => [`${variant.size}\u0000${variant.color}`, variant]));
  const editingVariant = form?.variantId ? data.variants.find(variant => variant.id === form.variantId) : undefined;
  const receiptVariant = receipt ? data.variants.find(variant => variant.id === receipt.variantId) : undefined;
  const lossVariant = loss ? data.variants.find(variant => variant.id === loss.variantId) : undefined;
  const selectedVariant = selected ? data.variants.find(variant => variant.id === selected.id) : undefined;
  function label(variant: Variant) { return `${products.get(variant.productId)?.name ?? 'Producto'} · Talle ${variant.size} · ${variant.color}`; }
  function openForm(variant?: Variant) {
    const product = variant && products.get(variant.productId);
    setSelected(null);
    setForm(variant ? { variantId: variant.id, productId: variant.productId, name: product?.name ?? '', category: product?.category ?? '', sku: variant.sku, size: variant.size, color: variant.color, cost: amountInput(variant.cost), retailPrice: amountInput(variant.retailPrice), wholesalePrice: amountInput(variant.wholesalePrice), stock: String(variant.stock), minStock: String(variant.minStock) }
      : { productId: '', name: '', category: 'Conjuntos', sku: `SL-${crypto.randomUUID().slice(0, 6).toUpperCase()}`, size: '', color: '', cost: '0', retailPrice: '', wholesalePrice: '', stock: '0', minStock: '3' });
  }
  function openReceipt(variant: Variant) {
    setSelected(null);
    setReceipt({ variantId: variant.id, quantity: '1', totalCost: amountInput(variant.cost), note: '', date: localDate(), paid: false, paymentMethod: 'Transferencia', commandId: crypto.randomUUID() });
  }
  function openLoss(variant: Variant) {
    setSelected(null);
    setLoss({ variantId: variant.id, quantity: '1', note: '', date: localDate(), confirmed: false, commandId: crypto.randomUUID() });
  }
  function update(key: keyof VariantForm, value: string) { setForm(current => current && ({ ...current, [key]: value })); }
  function selectModel(productId: string) {
    const product = products.get(productId);
    setForm(current => current && ({ ...current, productId, name: product?.name ?? '', category: product?.category ?? 'Conjuntos' }));
  }
  async function run(operation: () => Promise<void>, success: string) {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try { await operation(); notify(success); }
    catch (error) { notify(error instanceof Error ? error.message : 'No se pudo completar la operación.', 'error'); }
    finally { submitting.current = false; setSaving(false); }
  }
  async function openPurchaseHistory() {
    setPurchaseHistoryOpen(true);
    setPurchaseLoading(true);
    setPurchaseError('');
    try { setPurchases((await listPurchases()).sort((a, b) => b.business_date.localeCompare(a.business_date))); }
    catch (error) { const message = error instanceof Error ? error.message : 'No se pudieron leer las compras.'; setPurchaseError(message); notify(message, 'error'); }
    finally { setPurchaseLoading(false); }
  }
  function choosePurchasePayment(purchase: Purchase) {
    setPurchaseHistoryOpen(false);
    setPurchasePayment({ purchase, date: localDate(), method: paidMethods.includes(purchase.method as PaidMethod) ? purchase.method as PaidMethod : 'Transferencia', confirmed: false });
  }
  async function submitPurchasePayment(event: FormEvent) {
    event.preventDefault();
    if (!purchasePayment) return;
    const draft = purchasePayment;
    await run(async () => {
      if (!draft.confirmed) throw new Error('Confirmá el importe y el pago antes de continuar.');
      await payPurchase(draft.purchase.id, draft.method, draft.date);
      setPurchasePayment(null);
      await openPurchaseHistory();
    }, 'Pago de compra registrado. Se actualizó caja sin descontar otra vez la ganancia.');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    const draft = form;
    await run(async () => {
      const persisted = draft.variantId ? data.variants.find(variant => variant.id === draft.variantId) : undefined;
      if (draft.variantId && !persisted) throw new Error('Esta variante ya no existe. Cerrá el formulario y actualizá el inventario.');
      const existingProduct = data.products.find(product => normalize(product.name) === normalize(draft.name));
      await saveVariant({ ...draft, productId: draft.productId || existingProduct?.id || undefined,
        cost: persisted?.cost ?? amount(draft.cost, 'Costo inicial'), retailPrice: amount(draft.retailPrice, 'Precio minorista'),
        wholesalePrice: amount(draft.wholesalePrice, 'Precio mayorista'), stock: persisted?.stock ?? count(draft.stock, 'Stock inicial'),
        minStock: count(draft.minStock, 'Stock mínimo') });
      setForm(null);
    }, draft.variantId ? 'Variante actualizada. El stock y el CPP se conservan.' : 'Nueva variante agregada al inventario.');
  }
  async function submitReceipt(event: FormEvent) {
    event.preventDefault();
    if (!receipt) return;
    const draft = receipt;
    await run(async () => {
      await receiveStock({ variantId: draft.variantId, quantity: count(draft.quantity, 'Unidades', 1), totalCost: amount(draft.totalCost, 'Costo total'), note: draft.note.trim(), date: draft.date, paid: draft.paid, paymentMethod: draft.paymentMethod, commandId: draft.commandId });
      setReceipt(null);
    }, 'Entrada registrada. El inventario y el CPP se actualizaron.');
  }
  async function submitLoss(event: FormEvent) {
    event.preventDefault();
    if (!loss) return;
    const draft = loss;
    await run(async () => {
      const quantity = count(draft.quantity, 'Unidades', 1);
      if (!draft.note.trim()) throw new Error('Escribí el motivo de la merma para conservar su historial.');
      if (!draft.confirmed) throw new Error('Confirmá el descuento de inventario antes de continuar.');
      const variant = data.variants.find(item => item.id === draft.variantId);
      if (!variant || quantity > variant.available) throw new Error('La merma supera el stock disponible. Las unidades reservadas no se pueden descontar.');
      await adjustStock({ variantId: draft.variantId, delta: -quantity, note: draft.note.trim(), date: draft.date, commandId: draft.commandId });
      setLoss(null);
    }, 'Merma registrada al CPP vigente. Se conservó el historial del ajuste.');
  }
  let receiptCpp: number | null = null;
  let receiptUnitCost: number | null = null;
  if (receipt && receiptVariant) {
    try {
      const quantity = count(receipt.quantity, 'Unidades', 1);
      const total = amount(receipt.totalCost, 'Costo total');
      receiptCpp = roundedRatio(receiptVariant.inventoryValue + total, receiptVariant.stock + quantity);
      receiptUnitCost = roundedRatio(total, quantity);
    } catch { /* An incomplete amount is displayed as pending calculation. */ }
  }
  return <div className="inventory-page">
    <div className="page-heading"><div><p className="eyebrow">CADA DETALLE CUENTA</p><h1>Tu inventario<span className="heading-dot">.</span></h1><p className="page-subtitle">Modelo, talle y color, con reservas y costos que reflejan tus compras.</p></div><button className="btn btn-primary" onClick={() => openForm()}><Plus size={18} /> Nueva variante</button></div>
    <div className="inventory-overview"><div className="mini-stat"><span className="muted">Variantes activas</span><strong>{active.length}</strong></div><div className="mini-stat"><span className="muted">Prendas disponibles</span><strong>{active.reduce((sum, variant) => sum + variant.available, 0)}</strong></div><div className="mini-stat"><span className="muted">Valor del inventario</span><strong>{money(active.reduce((sum, variant) => sum + variant.inventoryValue, 0))}</strong></div><button className={`mini-stat stock-filter ${lowOnly ? 'selected' : ''}`} onClick={() => setLowOnly(!lowOnly)} aria-pressed={lowOnly}><span className="muted"><AlertTriangle size={15} /> Para reponer</span><strong>{low.length}<small> variantes</small></strong></button></div>
    <section className="panel">
      <div className="panel-head"><div><h2>Tu colección, en detalle</h2><p>Disponible = físico − reservado. El CPP se calcula sobre el valor exacto de inventario.</p></div><button className="btn btn-secondary btn-small" onClick={openPurchaseHistory}><ArrowDownToLine size={14} />Compras y entradas</button><div className="segmented" aria-label="Vista de inventario"><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-pressed={view === 'list'}><List size={14} /> Lista</button><button className={view === 'matrix' ? 'active' : ''} onClick={() => setView('matrix')} aria-pressed={view === 'matrix'}><Grid2X2 size={14} /> Matriz</button></div></div>
      <div className="toolbar inventory-toolbar"><label className="search-input"><Search size={17} /><input aria-label="Buscar en inventario" placeholder="Buscar modelo, categoría o SKU…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Filtrar categoría" value={category} onChange={event => setCategory(event.target.value)}><option value="">Todas las categorías</option>{categories.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Filtrar talle" value={size} onChange={event => setSize(event.target.value)}><option value="">Todos los talles</option>{sizes.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Filtrar color" value={color} onChange={event => setColor(event.target.value)}><option value="">Todos los colores</option>{colors.map(value => <option key={value}>{value}</option>)}</select></div>
      {filtered.length ? view === 'list' ? <div className="table-wrap"><table><thead><tr><th>Producto / variante</th><th>CPP unitario</th><th>Minorista</th><th>Mayorista</th><th>Físico</th><th>Reservado</th><th>Disponible</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{filtered.map(variant => <tr key={variant.id}><td><div className="product-cell"><span className="product-symbol"><Package size={20} /></span><div><strong>{products.get(variant.productId)?.name ?? 'Producto'}</strong><small>Talle {variant.size} · {variant.color} <span className="muted">/ {variant.sku}</span></small></div></div></td><td title={`Valor total de esta variante: ${money(variant.inventoryValue)}`}>{money(variant.cost)}</td><td><strong>{money(variant.retailPrice)}</strong></td><td>{money(variant.wholesalePrice)}</td><td>{variant.stock}</td><td>{variant.reserved}</td><td><span className={`badge ${variant.available <= variant.minStock ? 'badge-warning' : 'badge-success'}`}>{variant.available <= variant.minStock && <AlertTriangle size={12} />}{variant.available} uds.</span><small className="stock-min muted">Mín. {variant.minStock}</small></td><td><div className="row-actions"><button className="icon-btn" title="Editar variante" aria-label={`Editar ${label(variant)}`} onClick={() => openForm(variant)}><Pencil size={15} /></button><button className="icon-btn" title="Registrar entrada" aria-label={`Registrar entrada de ${label(variant)}`} onClick={() => openReceipt(variant)}><ArrowDownToLine size={16} /></button><button className="icon-btn" title="Registrar merma o faltante" aria-label={`Registrar merma de ${label(variant)}`} disabled={variant.available <= 0} onClick={() => openLoss(variant)}><Minus size={16} /></button></div></td></tr>)}</tbody></table></div>
        : <div className="inventory-matrix"><div className="inventory-matrix-controls"><Field label="Modelo de la matriz"><select value={effectiveMatrixId} onChange={event => setMatrixProductId(event.target.value)}>{filteredProducts.map(product => <option value={product.id} key={product.id}>{product.name}</option>)}</select></Field><p className="muted">Elegí una celda para editar precios, recibir mercadería o registrar un faltante.</p></div><div className="table-wrap"><table><thead><tr><th scope="col">Color / Talle</th>{matrixSizes.map(value => <th scope="col" key={value}>Talle {value}</th>)}</tr></thead><tbody>{matrixColors.map(colorName => <tr key={colorName}><th scope="row">{colorName}</th>{matrixSizes.map(sizeName => { const variant = matrixCells.get(`${sizeName}\u0000${colorName}`); return <td key={sizeName}>{variant ? <button className={`inventory-matrix-cell ${variant.available <= variant.minStock ? 'stock-low' : ''}`} onClick={() => setSelected(variant)} aria-label={`${label(variant)}: ${variant.available} disponibles, ${variant.stock} físicas, ${variant.reserved} reservadas`}><strong>{variant.available} <span>/ {variant.stock}</span></strong><small>disponibles / físicas</small><span className="muted">{variant.reserved} reservadas · {money(variant.retailPrice)}</span></button> : <span className="muted" title="Esta combinación no está registrada">—</span>}</td>; })}</tr>)}</tbody></table></div></div>
        : <EmptyState title={active.length ? 'No encontramos variantes' : 'Tu próxima colección empieza acá'} detail={active.length ? 'Probá con otro nombre o cambiá los filtros.' : 'Agregá tu primer modelo con talle, color y precios para comenzar a vender.'} action={!active.length && <button className="btn btn-primary" onClick={() => openForm()}><Plus size={17} /> Agregar variante</button>} />}
      <div className="table-footer"><span>{filtered.length} de {active.length} variantes · stock físico y reservado por separado</span><span><ArrowDownToLine size={14} /> Importaciones y exportaciones en Datos y respaldos</span></div>
    </section>
    <div className="info-banner"><Package size={16} /><span>El CPP mostrado está redondeado para leerlo. Las ventas usan el valor total exacto del inventario, conservando los centavos. Las reservas no cambian ese valor.</span></div>
    {purchaseHistoryOpen && <Modal title="Compras y entradas de mercadería" onClose={() => !saving && setPurchaseHistoryOpen(false)} wide><p className="muted">Las recepciones ya están incluidas en el inventario. Registrar su pago solo mueve caja: no vuelve a descontar stock ni ganancia.</p>{purchaseLoading ? <p role="status">Leyendo entradas…</p> : purchaseError ? <div className="info-banner" role="alert">{purchaseError}<button className="btn btn-secondary" onClick={openPurchaseHistory}>Reintentar</button></div> : purchases.length ? <><div className="inventory-purchase-summary"><span>{purchases.length} entradas registradas</span><strong>Pendiente de pago: {money(purchases.filter(purchase => !purchase.paid).reduce((sum, purchase) => sum + purchase.total_cost_cents, 0))}</strong></div><div className="table-wrap"><table><thead><tr><th>Fecha</th><th>Producto / referencia</th><th>Unidades</th><th>Total de compra</th><th>Pago</th></tr></thead><tbody>{purchases.map(purchase => { const variant = data.variants.find(item => item.id === purchase.variant_id); return <tr key={purchase.id}><td>{purchase.business_date.split('-').reverse().join('/')}</td><td><strong>{purchase.model ?? (variant ? products.get(variant.productId)?.name : undefined) ?? 'Mercadería'}</strong><small className="stock-min muted">{purchase.sku ?? variant?.sku ?? ''}{purchase.note ? ` · ${purchase.note}` : ''}</small></td><td>{purchase.quantity}</td><td>{money(purchase.total_cost_cents)}</td><td>{purchase.paid ? <span className="badge badge-success">Pagada · {purchase.method}</span> : <button className="btn btn-secondary btn-small" onClick={() => choosePurchasePayment(purchase)}>Registrar pago</button>}</td></tr>; })}</tbody></table></div></> : <EmptyState title="Todavía no registraste compras" detail="Usá la acción de entrada de una variante para recibir mercadería con su costo total. El inventario inicial no se cuenta como una compra nueva." />}</Modal>}
    {purchasePayment && <Modal title="Pagar compra pendiente" onClose={() => { if (!saving) { setPurchasePayment(null); setPurchaseHistoryOpen(true); } }}><form onSubmit={submitPurchasePayment}><p>Vas a registrar un pago completo de <strong>{money(purchasePayment.purchase.total_cost_cents)}</strong> por {purchasePayment.purchase.quantity} unidades recibidas el {purchasePayment.purchase.business_date.split('-').reverse().join('/')}.</p><div className="form-grid"><Field label="Fecha del pago"><input required type="date" min={purchasePayment.purchase.business_date} value={purchasePayment.date} onChange={event => setPurchasePayment({ ...purchasePayment, date: event.target.value, confirmed: false })} /></Field><Field label="Medio usado para pagar"><select value={purchasePayment.method} onChange={event => setPurchasePayment({ ...purchasePayment, method: event.target.value as PaidMethod, confirmed: false })}>{paidMethods.map(method => <option key={method}>{method}</option>)}</select></Field></div><p className="transfer-note">El inventario y el CPP ya se actualizaron al recibir esta compra. Este pago genera únicamente un egreso de caja.</p><label className="inventory-check"><input required type="checkbox" checked={purchasePayment.confirmed} onChange={event => setPurchasePayment({ ...purchasePayment, confirmed: event.target.checked })} /><span>Confirmo que pagué {money(purchasePayment.purchase.total_cost_cents)} mediante {purchasePayment.method}.</span></label><div className="form-actions"><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => { setPurchasePayment(null); setPurchaseHistoryOpen(true); }}>Volver</button><button className="btn btn-primary" disabled={saving || !purchasePayment.confirmed}>{saving ? 'Registrando…' : 'Confirmar pago'}</button></div></form></Modal>}
    {selectedVariant && <Modal title={label(selectedVariant)} onClose={() => setSelected(null)}><div className="detail-grid"><div><span>Stock físico</span><strong>{selectedVariant.stock}</strong></div><div><span>Reservado</span><strong>{selectedVariant.reserved}</strong></div><div><span>Disponible</span><strong>{selectedVariant.available}</strong></div><div><span>CPP unitario</span><strong>{money(selectedVariant.cost)}</strong></div></div><p className="accounting-note">SKU {selectedVariant.sku} · Minorista {money(selectedVariant.retailPrice)} · Mayorista {money(selectedVariant.wholesalePrice)} · Mínimo {selectedVariant.minStock}</p><div className="form-actions"><button className="btn btn-secondary" onClick={() => openForm(selectedVariant)}><Pencil size={15} />Editar precios</button><button className="btn btn-secondary" disabled={selectedVariant.available <= 0} onClick={() => openLoss(selectedVariant)}><Minus size={15} />Merma</button><button className="btn btn-primary" onClick={() => openReceipt(selectedVariant)}><Plus size={15} />Entrada</button></div></Modal>}
    {form && <Modal title={form.variantId ? 'Editar variante' : 'Nueva variante'} onClose={() => !saving && setForm(null)} wide><form onSubmit={submit} className="stack-form">
      {!form.variantId && <Field label="Modelo"><select value={form.productId} onChange={event => selectModel(event.target.value)}><option value="">Crear un modelo nuevo</option>{data.products.map(product => <option value={product.id} key={product.id}>{product.name}</option>)}</select></Field>}
      <div className="form-grid"><Field label="Nombre / modelo"><input required maxLength={100} value={form.name} onChange={event => update('name', event.target.value)} disabled={!!form.productId} placeholder="Conjunto Valentina" /></Field><Field label="Categoría"><input required maxLength={80} value={form.category} onChange={event => update('category', event.target.value)} disabled={!!form.productId} list="inventory-categories" /><datalist id="inventory-categories">{categories.map(value => <option value={value} key={value} />)}</datalist></Field><Field label="Talle"><input required maxLength={30} value={form.size} onChange={event => update('size', event.target.value)} placeholder="95" /></Field><Field label="Color"><input required maxLength={50} value={form.color} onChange={event => update('color', event.target.value)} placeholder="Rojo" /></Field><Field label="Código / SKU"><input required maxLength={80} value={form.sku} onChange={event => update('sku', event.target.value)} /></Field><Field label="Alerta de stock mínimo"><input required type="number" min="0" step="1" value={form.minStock} onChange={event => update('minStock', event.target.value)} /></Field><Field label="Precio minorista (ARS)"><input required inputMode="decimal" value={form.retailPrice} onChange={event => update('retailPrice', event.target.value)} placeholder="1250,50" /></Field><Field label="Precio mayorista (ARS)"><input required inputMode="decimal" value={form.wholesalePrice} onChange={event => update('wholesalePrice', event.target.value)} placeholder="1000,00" /></Field>{!form.variantId && <><Field label="Stock físico inicial"><input required type="number" min="0" step="1" value={form.stock} onChange={event => update('stock', event.target.value)} /></Field><Field label="Costo unitario inicial (ARS)" hint="Se incorpora al valor de inventario. No genera un pago de compra nuevo."><input required inputMode="decimal" value={form.cost} onChange={event => update('cost', event.target.value)} placeholder="600,00" /></Field></>}</div>
      {editingVariant && <div className="accounting-note"><strong>CPP actual: {money(editingVariant.cost)}</strong><br />Físico: {editingVariant.stock} · Reservado: {editingVariant.reserved} · Disponible: {editingVariant.available}. Para modificar existencias, registrá una entrada o una merma; el stock y el costo no se sobrescriben desde este formulario.</div>}
      <div className="form-actions"><button className="btn btn-secondary" type="button" onClick={() => setForm(null)} disabled={saving}>Cancelar</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar variante'}</button></div>
    </form></Modal>}
    {receipt && receiptVariant && <Modal title="Registrar entrada de mercadería" onClose={() => !saving && setReceipt(null)}><form onSubmit={submitReceipt}><p><strong>{label(receiptVariant)}</strong><br /><span className="muted">Físico: {receiptVariant.stock} · CPP actual: {money(receiptVariant.cost)}</span></p><div className="form-grid"><Field label="Unidades recibidas"><input required type="number" min="1" step="1" value={receipt.quantity} onChange={event => setReceipt({ ...receipt, quantity: event.target.value })} /></Field><Field label="Costo TOTAL de esta entrada (ARS)" hint="Ingresá el valor de todas las unidades recibidas."><input required inputMode="decimal" value={receipt.totalCost} onChange={event => setReceipt({ ...receipt, totalCost: event.target.value })} /></Field><Field label="Fecha de recepción"><input required type="date" value={receipt.date} onChange={event => setReceipt({ ...receipt, date: event.target.value })} /></Field><Field label="Proveedor / referencia (opcional)"><input maxLength={500} value={receipt.note} onChange={event => setReceipt({ ...receipt, note: event.target.value })} placeholder="Comprobante o nota de la compra" /></Field></div><div className="accounting-note">Costo unitario de esta entrada: <strong>{receiptUnitCost === null ? 'Completá los importes' : money(receiptUnitCost)}</strong>.<br />Nuevo CPP estimado: <strong>{receiptCpp === null ? 'Pendiente de cálculo' : money(receiptCpp)}</strong>.</div><label className="inventory-check"><input type="checkbox" checked={receipt.paid} onChange={event => setReceipt({ ...receipt, paid: event.target.checked })} /><span>Ya pagué esta compra: registrar egreso de caja.</span></label>{receipt.paid && <Field label="Medio usado para pagar la compra"><select value={receipt.paymentMethod} onChange={event => setReceipt({ ...receipt, paymentMethod: event.target.value as PaidMethod })}>{paidMethods.map(method => <option key={method}>{method}</option>)}</select></Field>}<p className="transfer-note">La entrada aumenta inventario y recalcula el CPP. El pago afecta caja; la compra no se descuenta otra vez como gasto operativo.</p><div className="form-actions"><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setReceipt(null)}>Cancelar</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Registrando…' : 'Registrar entrada'}<ArrowUpRight size={15} /></button></div></form></Modal>}
    {loss && lossVariant && <Modal title="Registrar merma o faltante" onClose={() => !saving && setLoss(null)}><form onSubmit={submitLoss}><p><strong>{label(lossVariant)}</strong><br /><span className="muted">Hay {lossVariant.available} unidades disponibles. Las {lossVariant.reserved} reservadas no pueden descontarse.</span></p><div className="form-grid"><Field label="Unidades a descontar"><input required type="number" min="1" max={lossVariant.available} step="1" value={loss.quantity} onChange={event => setLoss({ ...loss, quantity: event.target.value, confirmed: false })} /></Field><Field label="Fecha"><input required type="date" value={loss.date} onChange={event => setLoss({ ...loss, date: event.target.value })} /></Field></div><Field label="Motivo del ajuste" hint="La pérdida queda registrada en el historial y en los resultados financieros."><textarea required maxLength={1000} rows={3} value={loss.note} onChange={event => setLoss({ ...loss, note: event.target.value })} placeholder="Ej. Rotura de una prenda o diferencia de conteo." /></Field><div className="info-banner"><AlertTriangle size={17} /><span>Se descontarán unidades físicas al CPP vigente. Esta operación reconoce una pérdida de inventario; no es una venta ni genera cobros.</span></div><label className="inventory-check"><input type="checkbox" required checked={loss.confirmed} onChange={event => setLoss({ ...loss, confirmed: event.target.checked })} /><span>Confirmo el faltante y el descuento de {loss.quantity || 'estas'} unidades.</span></label><div className="form-actions"><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setLoss(null)}>Cancelar</button><button className="btn btn-danger" disabled={saving || !loss.confirmed}>{saving ? 'Guardando…' : 'Confirmar merma'}</button></div></form></Modal>}
  </div>;
}
