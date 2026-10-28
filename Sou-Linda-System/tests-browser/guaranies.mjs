import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use an isolated --data-dir only. This test creates a sale and restores a backup.
const base=process.env.SOU_LINDA_TEST_URL??'http://127.0.0.1:8765';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(15000);
const artifacts=new URL('../artifacts/',import.meta.url).pathname;
const folder=await mkdtemp(join(tmpdir(),'sou-linda-pyg-browser-'));
await mkdir(artifacts,{recursive:true});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const checks=[];
const nav=name=>page.getByRole('navigation',{name:'Navegación de Sou Linda Ágil'}).getByRole('button',{name});
const read=path=>page.evaluate(async url=>{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();},path);
const whole=(value,label)=>assert.equal(value%100,0,`${label} debe estar expresado en guaraníes enteros`);
const noLegacy=async target=>assert(!/\bARS\b|Pesos argentinos|\$\s*\d/.test(await target.innerText()),'Una base PYG no debe mostrar moneda argentina');

try{
  await page.goto(base+'/agil');
  await page.getByRole('heading',{name:'Tu negocio, al día.'}).waitFor();
  if(await page.getByRole('button',{name:'Explorar demo',exact:true}).count()){
    await page.getByRole('button',{name:'Explorar demo',exact:true}).click();
    await page.getByRole('button',{name:'Cargar datos de ejemplo',exact:true}).click();
  }
  await page.getByText('Datos de ejemplo. Explorá todas las funciones antes de cargar tu negocio.',{exact:true}).waitFor();
  const before=await read('/api/snapshot');
  assert(before.settings.some(row=>row.key==='demo'&&row.value==='true'),'La prueba requiere datos de demostración');
  assert(before.settings.some(row=>row.key==='currency'&&row.value==='PYG'),'La nueva base debe declarar su moneda PYG');
  await page.waitForFunction(()=>document.querySelector('.ag-month-value strong')?.textContent?.includes('₲'));
  await noLegacy(page.locator('body'));
  await page.screenshot({path:artifacts+'sou-linda-pyg-inicio.png',fullPage:true});
  checks.push('nueva base PYG','inicio en guaraníes');

  const variant=before.variants.find(row=>row.sku==='VAL-95-ROJ'&&row.active&&row.available>0);
  assert(variant,'La demo debe tener una variante Valentina 95 Rojo disponible');
  await page.locator('aside.ag-sidebar').getByRole('button',{name:'Registrar venta F2',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('input[aria-label="Buscar producto para vender"]')?.disabled);
  const clear=page.getByRole('button',{name:'Vaciar borrador',exact:true});
  if(await clear.isEnabled()){page.once('dialog',dialog=>dialog.accept());await clear.click();await page.getByText('Elegí una prenda para empezar',{exact:true}).waitFor();}
  await page.getByLabel('Talle de productos').selectOption('95');
  await page.getByLabel('Color de productos').selectOption('Rojo');
  await page.getByLabel('Buscar producto para vender').fill(variant.sku);
  await page.locator('button.catalog-card:not([disabled])').first().click();
  const price=page.getByLabel(`Precio unitario de ${variant.sku}`,{exact:true});
  await price.fill('50000.50');
  await page.waitForFunction(()=>document.querySelector('button.checkout-submit')?.disabled);
  assert(await page.getByRole('button',{name:'Completar venta',exact:true}).isDisabled(),'Un precio fraccionario PYG no se puede completar');
  await price.fill('50000');
  await page.getByLabel('Clienta',{exact:true}).selectOption(before.customers[0].id);
  await page.getByLabel('Canal de venta',{exact:true}).selectOption('WhatsApp');
  await page.getByLabel('Cobro al completar',{exact:true}).selectOption('Efectivo');
  const date=await page.getByLabel('Fecha del pedido',{exact:true}).inputValue();
  const reportBefore=await read(`/api/reports/monthly?month=${date.slice(0,7)}`);
  assert.equal(reportBefore.currency,'PYG');
  await page.getByText('Promoción, comisión y costos directos',{exact:true}).click();
  await page.getByLabel('Tipo de descuento',{exact:true}).selectOption('percent');
  await page.getByLabel('Descuento (%)',{exact:true}).fill('1.25');
  assert(await page.getByRole('button',{name:'Completar venta',exact:true}).isEnabled(),'Los porcentajes conservan sus dos decimales');
  await page.getByLabel('Descuento (%)',{exact:true}).fill('12.5');
  await page.getByLabel('Comisión del cobro (%)',{exact:true}).fill('3');
  await page.getByLabel('Packaging (₲)',{exact:true}).fill('3000');
  await page.getByLabel('Envío asumido (₲)',{exact:true}).fill('7000');
  await page.getByLabel('Envío y packaging se pagan al completar',{exact:true}).check();
  await page.getByLabel('Medio para envío y packaging',{exact:true}).selectOption('Efectivo');
  await page.waitForFunction(()=>document.querySelector('.sale-totals')?.textContent?.includes('₲ 43.750'));
  const preview=await page.locator('.sale-totals').innerText();
  assert(preview.includes('₲ 1.313'),'La comisión estimada debe redondear 1312,5 a 1313 guaraníes');
  await noLegacy(page.locator('body'));
  await page.screenshot({path:artifacts+'sou-linda-pyg-pos.png',fullPage:true});
  const saleResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sales'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Completar venta',exact:true}).click();
  const response=await saleResponse;assert(response.ok(),'La venta PYG debe confirmarse');
  const sale=await response.json();
  const numerator=BigInt(variant.inventoryValue);
  const denominator=BigInt(variant.stock)*100n;
  const cpp=Number(((2n*numerator+denominator)/(2n*denominator))*100n);
  assert.equal(sale.total,4375000);assert.equal(sale.discount,625000);assert.equal(sale.costTotal,cpp);
  assert.equal(sale.commissionCost,131300);assert.equal(sale.shippingCost,700000);assert.equal(sale.packagingCost,300000);
  for(const field of ['total','discount','costTotal','commissionCost','shippingCost','packagingCost','paid','balance'])whole(sale[field],field);
  const profit=4375000-cpp-131300-700000-300000;
  const after=await read('/api/snapshot');
  const stock=after.variants.find(row=>row.id===variant.id);
  assert.equal(stock.stock,variant.stock-1);assert.equal(stock.inventoryValue,variant.inventoryValue-cpp);
  for(const payment of after.payments.filter(row=>row.saleId===sale.id)){whole(payment.amount,'Cobro');whole(payment.commission,'Comisión efectiva');}
  const reportAfter=await read(`/api/reports/monthly?month=${date.slice(0,7)}`);
  assert.equal(reportAfter.net_profit_cents-reportBefore.net_profit_cents,profit);
  const daily=await read(`/api/reports/daily?date=${date}&opening=0`);assert.equal(daily.currency,'PYG');
  for(const row of daily.by_method)for(const field of ['income_cents','expense_cents','balance_cents'])whole(row[field],field);
  await page.getByRole('dialog',{name:'Venta registrada',exact:true}).waitFor();
  const receipt=await page.locator('.receipt-preview').innerText();
  assert(receipt.includes('₲ 43.750'));assert(!receipt.includes('$'));assert(!receipt.includes('ARS'));
  for(const line of receipt.split('\n').filter(line=>line.includes('₲')))assert(!/₲[^\n]*,\d/.test(line),'Los importes del recibo PYG no llevan decimales');
  const whatsapp=page.getByRole('link',{name:'Preparar WhatsApp',exact:true});
  assert(new URL(await whatsapp.getAttribute('href')).pathname.startsWith('/595'),'El recibo usa el prefijo paraguayo de la clienta de demo');
  await page.getByRole('button',{name:'Cerrar ventana',exact:true}).click();
  checks.push('fracciones PYG rechazadas','porcentajes decimales válidos','venta ₲50.000 con 12,5% y comisión redondeada','CPP y caja enteros','recibo ₲ y WhatsApp +595');

  await nav('Datos y respaldos').click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Descargar respaldo JSON',exact:true}).click();
  const download=await downloadPromise;const backupPath=join(folder,'pyg-business.json');await download.saveAs(backupPath);
  const backup=JSON.parse(await readFile(backupPath,'utf8'));
  assert(backup.payload.tables.meta.some(row=>row.key==='currency'&&row.value==='PYG'));
  const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Elegir respaldo JSON',exact:true}).click();
  await(await chooserPromise).setFiles(backupPath);
  await page.getByRole('dialog',{name:'¿Reemplazar todos los datos?',exact:true}).waitFor();
  await page.getByRole('button',{name:'Sí, reemplazar datos',exact:true}).click();
  await page.getByText('Base restaurada y validada.',{exact:true}).waitFor();
  const final=await read('/api/snapshot');
  for(const collection of ['products','variants','customers','sales','expenses','movements','payments','cashClosings'])assert.deepEqual(final[collection],after[collection],`El respaldo conserva ${collection}`);
  assert(final.settings.some(row=>row.key==='currency'&&row.value==='PYG'));
  assert.deepEqual(await read(`/api/reports/monthly?month=${date.slice(0,7)}`),reportAfter);
  checks.push('backup/restauración conserva PYG y todos los importes');

  const pair=await page.evaluate(async()=>{
    const session=await(await fetch('/api/session',{cache:'no-store'})).json();
    const response=await fetch('/api/mobile/pair',{method:'POST',headers:{'Content-Type':'application/json','X-SADI-CSRF':session.csrfToken},body:'{}'});
    if(!response.ok)throw new Error(`No se pudo preparar la prueba móvil (${response.status})`);
    return response.json();
  });
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const phone=await mobile.newPage();phone.setDefaultTimeout(15000);phone.on('pageerror',error=>errors.push(error.message));
  const calls=[];phone.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/'))calls.push(path);});
  const mobileResponse=phone.waitForResponse(response=>new URL(response.url()).pathname==='/api/mobile/reports');
  await phone.goto(base+'/mobile#token='+encodeURIComponent(pair.token));
  assert.equal((await(await mobileResponse).json()).currency,'PYG');
  await phone.getByText('Ganancia neta de gestión',{exact:true}).waitFor();
  await phone.waitForFunction(()=>document.querySelector('.mobile-report-stats')?.textContent?.includes('₲'));
  assert(!phone.url().includes('token='));assert(calls.every(path=>path==='/api/mobile/reports'));
  await noLegacy(phone.locator('body'));
  assert.equal(await phone.locator('body').evaluate(element=>element.scrollWidth>innerWidth),false);
  await phone.screenshot({path:artifacts+'sou-linda-pyg-reportes-celular.png',fullPage:true});
  await mobile.close();
  checks.push('reportes móviles PYG de solo lectura');

  await page.getByRole('link',{name:'Probar vista Clásica',exact:true}).click();
  await page.getByRole('button',{name:'Resumen',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.stat-grid')?.textContent?.includes('₲'));
  await noLegacy(page.locator('body'));
  await page.screenshot({path:artifacts+'sou-linda-pyg-clasica.png',fullPage:true});
  assert.deepEqual(errors,[],'No debe haber errores JavaScript');
  checks.push('vista Clásica también en guaraníes','sin errores JavaScript');
  console.log(JSON.stringify({result:'PASS',checks,screenshots:4}));
}catch(error){await page.screenshot({path:artifacts+'guaranies-failure.png',fullPage:true}).catch(()=>undefined);throw error;}
finally{await browser.close();await rm(folder,{recursive:true,force:true});}
