# Sou Linda System para Paraguay

La versión 0.5.0 inicia los negocios nuevos en **guaraníes paraguayos (PYG)**. Usa el símbolo **₲**, formato local `es-PY` e importes enteros: por ejemplo, **₲ 50.000**. La misma moneda se aplica en las vistas Clásica y Ágil, recibos, caja, reportes, exportaciones y consultas del celular.

## Cargar precios y gastos

En los formularios, escribí `50000` para cincuenta mil guaraníes. No agregues separadores de miles. Se rechazan las fracciones de guaraní; un valor equivalente con decimales cero, como `50000.00`, mantiene el mismo importe entero.

Los porcentajes admiten hasta dos decimales: `12,5` significa 12,5 %, tanto para descuentos como para comisiones. No se interpretan como importes de dinero.

En CSV o Excel, usá preferentemente importes enteros sin formato, como `50000`. El importador para una base PYG también reconoce la agrupación paraguaya `50.000`. Las fórmulas deben convertirse a valores antes de importar. La vista previa muestra la moneda del negocio y valida las fracciones.

## Cálculos y redondeo

Descuentos porcentuales, comisiones, costo reconocido al vender, devoluciones y reparto de gastos se calculan con enteros. El resultado se redondea al guaraní más cercano; los medios guaraníes se redondean alejándose de cero. Los repartos conservan el total en guaraníes y la última salida de inventario consume su valor restante.

Por ejemplo, una prenda de **₲ 50.000** con un descuento del **12,5 %** queda en **₲ 43.750**. Una comisión del **3 %** sobre ese cobro es **₲ 1.313**, después del redondeo. Si el costo es **₲ 24.000**, el envío **₲ 7.000** y el empaque **₲ 3.000**, el resultado de la venta es **₲ 8.437**, antes de gastos operativos.

La moneda figura en `meta.currency` dentro de la base y del backup. Por compatibilidad con los respaldos anteriores, los campos técnicos `*_cents` conservan una escala de 100: **₲ 50.000 se almacena como 5.000.000**. En una base PYG, los importes monetarios aceptados y reconocidos son múltiplos de 100 en esa escala. No son centavos cobrables ni decimales ocultos de guaraní.

## Si ya abriste una versión anterior

Las bases anteriores sin información de moneda y con registros se identifican como **ARS heredadas**. Sus números y su historial permanecen intactos; el sistema muestra una advertencia. Una corrección de símbolo no equivale a una conversión de moneda.

Si solo cargaste la demo anterior, podés descargar un backup y eliminar esa demo desde **Datos y respaldos**. Al quedar vacía, la base inicia en PYG y permite cargar la nueva demo de Paraguay.

Si hay datos reales en una base anterior, conservá su respaldo y revisá su moneda de origen antes de migrarlos. Una instalación o carpeta de datos nueva inicia en PYG. Importá únicamente los datos revisados y expresados en guaraníes; el importador no aplica un tipo de cambio automático.

Al restaurar un JSON se muestra su moneda y se conserva la denominación original. Una copia PYG restaura PYG; una copia antigua conserva ARS y la advertencia. El respaldo no cambia valores económicos para hacer coincidir una etiqueta.

## Contactos y recibos

Los contactos pueden guardarse con prefijo internacional `+595`. Al preparar un mensaje de WhatsApp, un celular local que comience por `09` se normaliza como `5959…`. No se envía el mensaje automáticamente. Los teléfonos de la demo son ficticios y no se toman de la imagen de redes de la tienda.

Los recibos son comprobantes internos. La moneda PYG no agrega facturación fiscal ni una integración tributaria automática.
