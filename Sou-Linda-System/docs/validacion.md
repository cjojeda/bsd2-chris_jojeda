# Verificación de Sou Linda System 0.5.0 · Guaraníes

Comprobaciones realizadas el 28 de octubre de 2026 sobre la edición web local. Los datos usados fueron ficticios y estuvieron en una carpeta temporal independiente del negocio.

| Comprobación | Resultado |
| --- | --- |
| Backend Python: dominio, CPP, concurrencia, reportes, importación, backup/restauración, HTTP y lanzador | 187 pruebas correctas |
| Frontend: precisión de importes, sesión/CSRF, saldos y recibos | 20 pruebas correctas |
| TypeScript y compilación de producción Vite/PWA | Correctos |
| Vista Ágil: cambio a Clásica, carrito compartido, stock, clientas, gasto y caja | Correctos; no se duplican datos al cambiar de vista |
| Diseño Ágil responsive a 390 px | Sin desborde horizontal ni errores JavaScript |
| Autotest aislado del lanzador | Correcto; no abre ni modifica la base real |
| Navegador Chromium: filtros talle/color, borrador, reserva, inventario y finanzas | Correctos |
| Navegador con tamaño móvil: reportes, QR, retiro del token del URL y revocación | Correctos; sin consultas administrativas ni desborde horizontal |
| Venta desde la interfaz: precio 2000, descuento 10%, comisión 3%, envío 100, empaque 50 | Costo CPP conservado; movimiento de inventario y resultado mensual exactos |
| PYG: precio 50.000, descuento 12,5%, comisión 3%, envío 7.000, empaque 3.000 | Total ₲ 43.750, comisión ₲ 1.313 y resultado ₲ 8.437 con CPP ₲ 24.000 |
| PYG: fracciones rechazadas, porcentajes con dos decimales, prefijo +595 y recibo | Correctos |
| PYG: restauración y reportes móviles | Moneda y totales conservados; sin llamadas administrativas desde el celular |
| Bases antiguas ARS | Se conservan moneda y valores; no hay conversión automática |
| Descarga y restauración JSON desde la interfaz | Colecciones y reporte mensual idénticos después de restaurar; POS habilitado |

El ejemplo financiero adicional del motor usa dos unidades con costo CPP de 1200 cada una, precio de 2000 por unidad, descuento del 10%, comisión del 3%, envío de 200 y packaging de 50:

```text
Venta neta:         ₲ 3.600
Costo de ventas:    ₲ 2.400
Comisión:             ₲ 108
Envío:                ₲ 200
Packaging:             ₲ 50
Resultado:            ₲ 842
```

Los importes PYG se ingresan y reconocen en guaraníes enteros; la escala técnica del código es 100 por compatibilidad con respaldos anteriores. Los gastos operativos se descuentan al calcular el resultado mensual, aparte del resultado de cada venta.

Las pruebas HTTP verifican rechazo de administración desde un cliente remoto, comprobación de host y origen, CSRF, límites de carga, permisos móviles de solo lectura, rotación y revocación del token, además de idempotencia financiera. La consulta móvil devuelve una proyección de campos agregados y excluye datos personales de clientas.

La ejecución de pruebas se hizo en Linux con Python 3.12 y Chromium. Los archivos `.cmd` fueron revisados, pero **no se ejecutaron en Windows real**, y la vista móvil se verificó con un contexto de navegador: falta comprobar el router, firewall y teléfono de la usuaria. El workflow de GitHub incluye Windows y Linux, pero no se ejecutó remotamente en esta entrega. La suite Python emite una advertencia de futura deprecación de httpx en TestClient; no afecta el resultado actual.

No hay un sitio publicado en Sites ni una URL pública de negocio. Los archivos de interfaz y el código entregados se ejecutan en la notebook con el motor local.

Para repetir las comprobaciones de navegador, iniciá el motor con una carpeta temporal mediante `--data-dir`, cargá la demo y ejecutá `tests-browser/guaranies.mjs`. Los otros recorridos están en `tests-browser/smoke.mjs`, `tests-browser/financial-flow.mjs` y `tests-browser/agile.mjs`. Esas pruebas crean pedidos y restauran respaldos: no deben apuntar a un negocio real.
