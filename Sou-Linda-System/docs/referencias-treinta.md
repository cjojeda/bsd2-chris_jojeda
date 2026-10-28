# Referencia funcional de Treinta para Sou Linda System · vista Ágil

Consulta de fuentes públicas oficiales realizada el **28 de octubre de 2026**. Esta revisión sirve para orientar una alternativa de interfaz cotidiana para una lencería. No se ingresó a una cuenta Treinta, no se inspeccionó su aplicación privada ni se accedió a datos del negocio de la usuaria.

## Funciones documentadas y aplicación a Sou Linda

| Fuente oficial | Funciones que describe | Decisión para la alternativa |
| --- | --- | --- |
| [Inicio de Treinta](https://www.treinta.co/) | Registro de ventas y gastos, flujo de caja, inventario, contactos y estadísticas; uso en celular y computador según su producto. | Poner las tareas del día y las acciones de venta/gasto en primer plano. Separar cobros de rentabilidad. |
| [Treinta para tiendas de ropa](https://www.treinta.co/programa-para-gestion-de-tienda-de-ropa-treinta/) | Existencias independientes por talle y color, búsqueda de prendas, actualización de inventario al vender, fotos de producto, reportes de prendas vendidas e importación Excel. | Identificar cada variante por modelo, talle y color; mostrar disponibilidad y reposición; reducir pasos para seleccionar una prenda. Las fotos son una referencia de evolución del catálogo y no una función implementada por esta consulta. |
| [Registro de ventas y gastos](https://www.treinta.co/registro-ventas-gastos/) | Registro ágil, gastos categorizados, entradas/salidas de dinero y reportes por período. | Inicio con fecha, resumen de movimientos reales y accesos directos a registrar venta, gasto y consultar caja. |
| [Control de deudas y fiados](https://www.treinta.co/control-de-deudas/) | Saldo por cliente, abonos parciales, historial de deuda y obligaciones con proveedores. | Dar visibilidad al fiado y a los cobros pendientes. Usar los cobros y saldos firmados del motor existente; las compras pendientes conservan su gestión actual y no se presenta un nuevo módulo integral de proveedores. |
| [Sitio de Treinta para Argentina](https://www.treinta.co/ar/home/) | Presenta las mismas familias de gestión cotidiana y distingue funciones de sus planes. | Usar vocabulario local: talles, clientas, fiado, caja, transferencia y pesos argentinos. |

Las páginas consultadas no garantizan que todas las funciones estén en cada plan o país. Presentan diferencias de precios y textos entre secciones; **esta entrega no utiliza sus precios ni compara planes comerciales**.

## Qué conserva Sou Linda

La nueva vista reutiliza la misma base y los mismos servicios de Sou Linda System: costo promedio ponderado, descuentos que reducen el ingreso, comisiones efectivas, costos de envío y empaque, gastos operativos, reservas, devoluciones, cobros, cierres y respaldos. Cambiar de vista no migra ni copia las operaciones.

La inspiración se limita a la organización de tareas y a funciones públicas descritas. Se mantienen nombre, diseño, componentes y código propios; no se reutilizan logos, capturas, imágenes, código ni textos comerciales de Treinta. No hay afiliación ni integración automática con esa plataforma.

Sou Linda sigue siendo una **web con Python y SQLite en la notebook**. La vista de reportes desde el celular requiere la misma Wi-Fi y el motor encendido, y continúa siendo de solo lectura. La disponibilidad de Treinta desde distintos lugares no se atribuye a esta aplicación local.

La migración desde Treinta sigue requiriendo el archivo exportado real y el mapeo de columnas del importador. Las páginas comerciales no se toman como evidencia de una API pública, de un formato fijo de exportación ni de una autorización para leer la cuenta.

## Registro de consulta

El [registro de fuentes](../server/docs/platform-sources/treinta-sources.json) conserva URL solicitada, URL final, momento de consulta y SHA-256 de la respuesta obtenida. No se redistribuyen las páginas completas ni sus recursos comerciales. Las conclusiones anteriores son un resumen funcional y deben revisarse si cambia el producto de referencia.
