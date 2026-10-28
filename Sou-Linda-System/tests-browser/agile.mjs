import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Run only against a disposable --data-dir with the demonstration database.
const base=process.env.SOU_LINDA_TEST_URL??'http://127.0.0.1:8765';
const artifacts=new URL('../artifacts/',import.meta.url).pathname;
await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(15000);
const failures=[];page.on('pageerror',error=>failures.push(error.message));
const checks=[];
const nav=name=>page.getByRole('navigation',{name:'Navegación de Sou Linda Ágil'}).getByRole('button',{name});
const read=path=>page.evaluate(async url=>{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();},path);
const saleButton=()=>page.locator('aside.ag-sidebar').getByRole('button',{name:'Registrar venta F2',exact:true});

try{
  await page.goto(base+'/agil');
  await page.getByRole('heading',{name:'Tu negocio, al día.'}).waitFor();
  if(await page.getByRole('button',{name:'Explorar demo',exact:true}).count()){
    await page.getByRole('button',{name:'Explorar demo',exact:true}).click();
    await page.getByRole('button',{name:'Cargar datos de ejemplo',exact:true}).click();
  }
  await page.getByText('Datos de ejemplo. Explorá todas las funciones antes de cargar tu negocio.',{exact:true}).waitFor();
  const snapshot=await read('/api/snapshot');
  assert(snapshot.settings.some(row=>row.key==='demo'&&row.value==='true'),'La prueba debe usar una base de demostración');
  await page.waitForFunction(()=>document.querySelector('.ag-month-value strong')?.textContent!=='Consultando…');
  assert((await page.locator('.ag-today-grid').innerText()).includes('Cobros menos pagos; no es ganancia.'),'El movimiento diario no debe confundirse con rentabilidad');
  assert((await page.locator('.ag-brand').innerText()).includes('Sou Linda'));
  const brandColor=await page.locator('.ag-sale-button').evaluate(element=>getComputedStyle(element).backgroundColor);
  assert.equal(brandColor,'rgb(142, 36, 69)','La acción principal debe usar el bordó de Sou Linda');
  await page.screenshot({path:artifacts+'sou-linda-agil-inicio.png',fullPage:true});checks.push('inicio diario','marca y paleta Sou Linda');

  await saleButton().click();
  await page.waitForFunction(()=>!document.querySelector('input[aria-label="Buscar producto para vender"]')?.disabled);
  const clear=page.getByRole('button',{name:'Vaciar borrador',exact:true});
  if(await clear.isEnabled()){page.once('dialog',dialog=>dialog.accept());await clear.click();await page.getByText('Elegí una prenda para empezar',{exact:true}).waitFor();}
  await page.getByLabel('Talle de productos').selectOption('95');
  await page.getByLabel('Color de productos').selectOption('Rojo');
  assert(await page.locator('button.catalog-card:not([disabled])').count()>0);
  await page.locator('button.catalog-card:not([disabled])').first().click();
  await page.getByLabel('Canal de venta',{exact:true}).selectOption('WhatsApp');
  await page.getByText('Borrador guardado en SQLite',{exact:true}).waitFor();
  await page.screenshot({path:artifacts+'sou-linda-agil-pos.png',fullPage:true});
  const beforeSwitch=await read('/api/snapshot');
  await page.getByRole('link',{name:'Probar vista Clásica',exact:true}).click();
  await page.getByRole('button',{name:'Resumen',exact:true}).waitFor();
  await page.getByRole('button',{name:'Punto de venta',exact:true}).click();
  await page.getByText('1 prenda seleccionada',{exact:true}).waitFor();
  const afterSwitch=await read('/api/snapshot');
  for(const collection of ['products','variants','sales','customers','expenses'])assert.deepEqual(afterSwitch[collection],beforeSwitch[collection],`Cambiar de vista debe conservar ${collection}`);
  await page.getByRole('link',{name:'Probar vista Ágil',exact:true}).click();
  await page.getByRole('heading',{name:'Tu negocio, al día.'}).waitFor();
  await saleButton().click();await page.getByText('1 prenda seleccionada',{exact:true}).waitFor();
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Vaciar borrador',exact:true}).click();
  await page.getByText('Elegí una prenda para empezar',{exact:true}).waitFor();
  checks.push('POS talle/color','borrador compartido entre vistas','cambio de vista sin duplicar operaciones');

  await nav('Inicio').click();
  await page.getByRole('button',{name:'Registrar gasto Anotá lo que sale del negocio',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Registrar gasto operativo',exact:true});await dialog.waitFor();
  const date=await dialog.getByLabel('Fecha del gasto',{exact:true}).inputValue();
  const monthlyBefore=await read(`/api/reports/monthly?month=${date.slice(0,7)}`);
  const dailyBefore=await read(`/api/reports/daily?date=${date}&opening=0`);
  const expensesBefore=await read('/api/snapshot');
  await dialog.getByLabel('Descripción',{exact:true}).fill('Prueba de gasto desde vista Ágil');
  await dialog.getByLabel('Importe (ARS)',{exact:true}).fill('17.50');
  await dialog.getByLabel('Categoría',{exact:true}).selectOption('Otros');
  await dialog.getByLabel('Medio de pago',{exact:true}).selectOption('Transferencia');
  await dialog.getByLabel('Ya lo pagué: registrar también el egreso real',{exact:true}).check();
  await dialog.getByRole('button',{name:'Guardar gasto',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  const expensesAfter=await read('/api/snapshot');
  assert.equal(expensesAfter.expenses.length,expensesBefore.expenses.length+1);
  const created=expensesAfter.expenses.find(row=>!expensesBefore.expenses.some(old=>old.id===row.id));
  assert.equal(created.amount,1750);assert.equal(created.paid,true);assert.equal(created.paymentMethod,'Transferencia');
  const monthlyAfter=await read(`/api/reports/monthly?month=${date.slice(0,7)}`);
  const dailyAfter=await read(`/api/reports/daily?date=${date}&opening=0`);
  assert.equal(monthlyAfter.net_profit_cents,monthlyBefore.net_profit_cents-1750);
  assert.equal(dailyAfter.expenses_cents,dailyBefore.expenses_cents+1750);
  assert.equal(dailyAfter.receipts_cents,dailyBefore.receipts_cents);
  checks.push('gasto directo desde inicio','gasto reduce ganancia y caja exactos');

  await nav('Caja diaria').click();
  await page.getByRole('heading',{name:'Movimientos por medio de pago',exact:true}).waitFor();
  await page.getByRole('heading',{name:'Arqueo de efectivo',exact:true}).waitFor();
  await page.screenshot({path:artifacts+'sou-linda-agil-caja.png',fullPage:true});
  await nav('Reportes').click();await page.getByRole('heading',{name:'Rentabilidad por canal',exact:true}).waitFor();
  await nav(/^Productos/).click();await page.getByRole('heading',{name:'Tu inventario.',exact:true}).waitFor();
  await page.getByRole('button',{name:'Matriz',exact:true}).click();await page.locator('.inventory-matrix').waitFor();
  await nav('Clientas').click();await page.getByRole('heading',{name:'Tus clientas.',exact:true}).waitFor();
  assert(await page.locator('main table tbody tr').count()>0);
  checks.push('caja diaria','reporte mensual','matriz de productos','clientas');

  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const phone=await mobile.newPage();phone.setDefaultTimeout(15000);phone.on('pageerror',error=>failures.push(error.message));
  await phone.goto(base+'/agil');await phone.getByRole('heading',{name:'Tu negocio, al día.'}).waitFor();
  await phone.waitForFunction(()=>document.querySelector('.ag-month-value strong')?.textContent!=='Consultando…');
  assert.equal(await phone.locator('body').evaluate(element=>element.scrollWidth>window.innerWidth),false,'La alternativa no debe desbordarse en 390 px');
  await phone.screenshot({path:artifacts+'sou-linda-agil-responsive.png',fullPage:true});
  await phone.getByRole('button',{name:'Abrir menú',exact:true}).click();
  await phone.getByRole('navigation',{name:'Navegación de Sou Linda Ágil'}).getByRole('button',{name:'Inicio',exact:true}).waitFor();
  await mobile.close();checks.push('adaptación responsive','menú compacto');
  assert.deepEqual(failures,[],'No debe haber errores JavaScript');
  console.log(JSON.stringify({result:'PASS',checks,screenshots:4}));
}catch(error){await page.screenshot({path:artifacts+'agile-failure.png',fullPage:true}).catch(()=>undefined);throw error;}
finally{await browser.close();}
