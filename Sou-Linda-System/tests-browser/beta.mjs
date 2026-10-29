import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Destructive test: run only on --beta --data-dir <disposable folder>.
// Runtime/demo guards below must pass before any mutation. The final step
// intentionally clears this test database; never point this at a shop's data.
const base = process.env.SOU_LINDA_TEST_URL ?? 'http://127.0.0.1:8766';
const target = new URL(base);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'La prueba requiere un servidor local');
const artifacts = new URL('../artifacts/', import.meta.url).pathname;
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'sou-linda-beta-browser-'));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = [];
const nav = name => page.getByRole('navigation', { name: 'Navegación de Sou Linda Ágil' }).getByRole('button', { name });
const read = path => page.evaluate(async url => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
}, path);
const setting = (snapshot, key) => snapshot.settings.find(row => row.key === key)?.value;
const betaVisible = () => page.getByText('BETA DE PRUEBA', { exact: true }).waitFor();
const saleButton = () => page.locator('aside.ag-sidebar').getByRole('button', { name: 'Registrar venta F2', exact: true });
const assertBusinessEqual = (actual, expected) => {
  for (const collection of ['products', 'variants', 'customers', 'sales', 'expenses', 'movements', 'payments', 'cashClosings']) {
    assert.deepEqual(actual[collection], expected[collection], `Se conserva ${collection}`);
  }
};

try {
  await page.goto(base + '/agil');
  await page.getByRole('heading', { name: 'Tu negocio, al día.' }).waitFor();
  await betaVisible();
  const initial = await read('/api/snapshot');
  assert.equal(setting(initial, 'runtime_mode'), 'beta', 'Rechazar cualquier servidor que no esté en modo beta');
  assert.equal(setting(initial, 'demo'), 'true', 'Requiere una base de demostración descartable');
  assert.equal(setting(initial, 'currency'), 'PYG', 'La beta inicia en guaraníes');
  assert(initial.variants.length > 0 && initial.sales.length > 0, 'La primera apertura ya trae datos ficticios');
  assert.equal(await page.getByRole('button', { name: 'Explorar demo', exact: true }).count(), 0, 'La beta no necesita cargar manualmente la demo');
  await page.waitForFunction(() => document.querySelector('.ag-month-value strong')?.textContent?.includes('₲'));
  assert(!/\bARS\b|Pesos argentinos|\$\s*\d/.test(await page.locator('body').innerText()));
  await page.screenshot({ path: artifacts + 'sou-linda-beta-inicio.png', fullPage: true });
  checks.push('inicio automático con datos ficticios en PYG', 'banner beta en vista Ágil');

  const variant = initial.variants.find(row => row.sku === 'VAL-95-ROJ' && row.active && row.available > 0);
  assert(variant, 'Se necesita Valentina 95 Rojo con disponibilidad');
  await saleButton().click();
  await page.waitForFunction(() => !document.querySelector('input[aria-label="Buscar producto para vender"]')?.disabled);
  const clearDraft = page.getByRole('button', { name: 'Vaciar borrador', exact: true });
  if (await clearDraft.isEnabled()) {
    page.once('dialog', dialog => dialog.accept());
    await clearDraft.click();
    await page.getByText('Elegí una prenda para empezar', { exact: true }).waitFor();
  }
  await page.getByLabel('Talle de productos').selectOption('95');
  await page.getByLabel('Color de productos').selectOption('Rojo');
  await page.getByLabel('Buscar producto para vender').fill(variant.sku);
  assert.equal(await page.locator('button.catalog-card').count(), 1, 'La combinación talle/color y SKU identifica una variante');
  await page.locator('button.catalog-card:not([disabled])').click();
  await page.getByLabel('Canal de venta', { exact: true }).selectOption('WhatsApp');
  await page.getByLabel('Cobro al completar', { exact: true }).selectOption('Transferencia');
  const date = await page.getByLabel('Fecha del pedido', { exact: true }).inputValue();
  await page.getByText('Borrador guardado en SQLite', { exact: true }).waitFor();
  await page.screenshot({ path: artifacts + 'sou-linda-beta-pos.png', fullPage: true });
  const beforeSwitch = await read('/api/snapshot');
  await page.getByRole('link', { name: 'Probar vista Clásica', exact: true }).click();
  await page.getByRole('button', { name: 'Resumen', exact: true }).waitFor();
  await betaVisible();
  await page.getByRole('button', { name: 'Punto de venta', exact: true }).click();
  await page.getByText('1 prenda seleccionada', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Canal de venta', { exact: true }).inputValue(), 'WhatsApp');
  assert.equal(await page.getByLabel('Cobro al completar', { exact: true }).inputValue(), 'Transferencia');
  assertBusinessEqual(await read('/api/snapshot'), beforeSwitch);
  await page.getByRole('link', { name: 'Probar vista Ágil', exact: true }).click();
  await page.getByRole('heading', { name: 'Tu negocio, al día.' }).waitFor();
  await saleButton().click();
  await page.getByText('1 prenda seleccionada', { exact: true }).waitFor();
  checks.push('filtro talle/color', 'borrador SQLite compartido entre vistas', 'banner beta en vista Clásica');

  const monthlyBefore = await read(`/api/reports/monthly?month=${date.slice(0, 7)}`);
  const reserveResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/sales' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Reservar stock', exact: true }).click();
  const reservedResponse = await reserveResponse;
  assert(reservedResponse.ok(), 'La reserva se registra desde el POS');
  const order = await reservedResponse.json();
  assert.equal(order.status, 'reserved');
  assert.equal(order.channel, 'WhatsApp');
  assert.equal(order.paid, 0);
  assert.equal(order.costTotal, null, 'El CPP se reconoce recién al completar');
  await page.getByRole('dialog', { name: 'Pedido guardado', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cerrar ventana', exact: true }).click();
  const reservedSnapshot = await read('/api/snapshot');
  const held = reservedSnapshot.variants.find(row => row.id === variant.id);
  assert.equal(held.stock, variant.stock);
  assert.equal(held.inventoryValue, variant.inventoryValue);
  assert.equal(held.reserved, variant.reserved + 1);
  assert.equal(held.available, variant.available - 1);
  assert.deepEqual(reservedSnapshot.payments, initial.payments, 'Reservar no inventa un cobro');
  assert.deepEqual(await read(`/api/reports/monthly?month=${date.slice(0, 7)}`), monthlyBefore, 'Reservar no reconoce ingresos ni costos');
  await nav('Ventas y pedidos').click();
  await page.getByLabel('Buscar pedidos').fill(order.number);
  await page.getByRole('button', { name: `Ver detalle ${order.number}`, exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  await page.getByRole('dialog', { name: 'Cancelar pedido', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Confirmar cancelación', exact: true }).click();
  await page.getByText('Pedido cancelado. Sus reservas quedaron liberadas.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cerrar ventana', exact: true }).click();
  const canceled = await read('/api/snapshot');
  assert.deepEqual(canceled.variants.find(row => row.id === variant.id), variant, 'Cancelar restaura toda la disponibilidad original');
  assert.equal(canceled.sales.find(row => row.id === order.id).status, 'void');
  assert.deepEqual(await read(`/api/reports/monthly?month=${date.slice(0, 7)}`), monthlyBefore);
  checks.push('reserva sin salida física ni cobro ni ganancia', 'cancelación repone disponibilidad automáticamente');

  await nav('Reportes').click();
  await page.getByRole('heading', { name: 'Rentabilidad por canal', exact: true }).waitFor();
  await betaVisible();
  const notification = page.getByRole('button', { name: 'Cerrar notificación', exact: true });
  if (await notification.count()) await notification.click();
  await page.screenshot({ path: artifacts + 'sou-linda-beta-reportes.png', fullPage: true });
  checks.push('dashboard financiero en PYG y canales sociales');

  await nav('Datos y respaldos').click();
  await page.getByRole('heading', { name: 'Vaciar los datos de prueba', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Empezar con tus datos reales', exact: true }).count(), 0, 'La beta debe mantener claro que es un entorno de prueba');
  const beforeBackup = await read('/api/snapshot');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar respaldo JSON', exact: true }).click();
  const download = await downloadPromise;
  const backupPath = join(temporary, 'sou-linda-beta.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert(backup.payload.tables.meta.some(row => row.key === 'currency' && row.value === 'PYG'));
  assert(!backup.payload.tables.meta.some(row => row.key === 'runtime_mode'), 'El modo beta es del servidor, no un dato restaurable');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Elegir respaldo JSON', exact: true }).click();
  await (await chooserPromise).setFiles(backupPath);
  await page.getByRole('dialog', { name: '¿Reemplazar todos los datos?', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sí, reemplazar datos', exact: true }).click();
  await page.getByText('Base restaurada y validada.', { exact: true }).waitFor();
  await betaVisible();
  const restored = await read('/api/snapshot');
  assertBusinessEqual(restored, beforeBackup);
  assert.equal(setting(restored, 'runtime_mode'), 'beta');
  assert.deepEqual(await read(`/api/reports/monthly?month=${date.slice(0, 7)}`), monthlyBefore);
  checks.push('descarga JSON', 'restauración conserva registros, reportes y banner beta');

  // This explicit UI confirmation intentionally empties only the guarded beta.
  await page.getByRole('button', { name: 'Vaciar base de demostración', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Vaciar la base de demostración', exact: true });
  await dialog.waitFor();
  await dialog.getByLabel('Escribí ELIMINAR para confirmar', { exact: true }).fill('ELIMINAR');
  await dialog.getByRole('button', { name: 'Eliminar todos los datos', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await betaVisible();
  const empty = await read('/api/snapshot');
  for (const key of ['products', 'variants', 'sales', 'customers', 'expenses', 'movements', 'payments', 'cashClosings']) assert.equal(empty[key].length, 0, `La limpieza vacía ${key}`);
  assert.equal(setting(empty, 'runtime_mode'), 'beta');
  assert.equal(setting(empty, 'currency'), 'PYG');
  assert.equal(setting(empty, 'demo'), undefined);
  await page.reload();
  await page.getByRole('heading', { name: 'Tus datos, siempre tuyos.' }).waitFor();
  await betaVisible();
  assert.equal((await read('/api/snapshot')).sales.length, 0);
  checks.push('limpieza explícita mantiene beta PYG', 'recarga conserva base vacía sin recargar demo');
  assert.deepEqual(errors, [], 'No debe haber errores JavaScript');
  checks.push('sin errores JavaScript');
  console.log(JSON.stringify({ result: 'PASS', checks, screenshots: 3, finalState: 'beta vacía después de limpieza explícita' }));
} catch (error) {
  await page.screenshot({ path: artifacts + 'sou-linda-beta-failure.png', fullPage: true }).catch(() => undefined);
  throw error;
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
