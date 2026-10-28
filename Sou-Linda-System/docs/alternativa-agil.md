# Sou Linda System: alternativa Ágil

Sou Linda System ofrece dos formas de trabajar con el mismo negocio. **Clásica** conserva la interfaz original; **Ágil** es una segunda propuesta con mayor énfasis en las operaciones del día, accesos directos y registro de ventas. Toma como referencia la facilidad de uso que buscás en Treinta, con identidad propia y reglas específicas de lencería.

## Cómo abrir cada propuesta

| Opción | Archivo de inicio en Windows | Ruta de la interfaz |
| --- | --- | --- |
| Clásica | `Iniciar-Sou-Linda-System.cmd` | `/` |
| Ágil | `Abrir-Sou-Linda-Agil.cmd` | `/agil` |

Extraé el paquete completo antes de abrir el archivo. Ambos accesos utilizan el mismo entorno Python y la misma interfaz compilada; no requieren instalar otro programa ni copiar la base del negocio. La primera preparación necesita Python 3.12 o posterior e Internet para descargar las dependencias. Después, el uso diario funciona sin Internet mientras el motor local esté abierto.

Si el motor ya está abierto, usá el cambio de vista desde la interfaz. Si preferís iniciar con el otro archivo `.cmd`, cerrá primero el motor anterior con **Ctrl+C**. No inicies dos motores sobre el mismo negocio.

Para iniciar desde una terminal de desarrollo:

```text
python server/run.py --view agile
```

El parámetro `--view classic`, o no indicar `--view`, abre la propuesta original. `--no-browser` sigue disponible si querés iniciar solo el motor.

## Qué cambia en Ágil

- Una pantalla de inicio enfocada en el día: cobros, egresos, pedidos y alertas.
- Acceso directo a una nueva venta y al catálogo por modelo, talle y color.
- Recorrido corto hacia pedidos, clientas, finanzas y respaldos.
- Una presentación visual alternativa para probar cuál resulta más cómoda.

Los cobros y egresos del día describen **dinero registrado**. Su diferencia es movimiento de caja; no equivale a la ganancia neta. La rentabilidad se consulta con los costos y gastos del período.

## Identidad visual de la tienda

La referencia de redes proporcionada por la usuaria orienta los colores y los contornos: bordó `#8E2445`, rosa suave `#F8EDF1`, marfil `#FBF9F8`, dorado tenue `#B79B62` y acentos verde salvia `#718276`. El nombre sigue siendo Sou Linda System. Los detalles florales y geométricos se reservan para la marca y el encabezado, conservando legibilidad en precios, stock y formularios. La imagen de redes no se usa para inferir teléfonos, cuentas ni datos financieros.

## Guaraníes en ambas vistas

Los negocios nuevos usan PYG y muestran precios como **₲ 50.000**, sin decimales. La [guía de guaraníes](guaranies.md) explica los porcentajes, el redondeo y el tratamiento de bases anteriores.

## Una sola base para las dos vistas

Las dos propuestas leen y escriben `sou-linda.sqlite3`, que normalmente está en `%LOCALAPPDATA%\SouLindaSystem`. Una venta registrada en Ágil también aparece en Clásica. Cambiar de interfaz no importa, duplica ni elimina registros, y no modifica el esquema de la base.

Se conservan las reglas del motor financiero: CPP al completar la venta, costo histórico, descuentos que reducen ingresos, comisiones efectivas y costos de envío/empaque. Las reservas reducen el disponible; al cancelarlas se liberan las unidades. Fiado, cobros, devoluciones y reembolsos siguen siendo operaciones separadas. Una venta histórica sin costo completo mantiene la ganancia pendiente.

Los respaldos y la restauración JSON contienen el negocio completo, independientemente de la interfaz elegida. Para comparar el diseño sin mezclar pruebas con ventas reales, usá una carpeta separada con `--data-dir` y cargá la demo únicamente en esa base vacía.

## Celular y Treinta

El acceso móvil conserva su alcance: reportes de solo lectura desde Chrome en la misma Wi-Fi, con la notebook y el motor encendidos. Para iniciar Ágil y habilitar ese acceso juntos, agregá `--mobile`:

```text
python server/run.py --view agile --mobile
```

También podés pasar `--mobile` al acceso de Windows desde una terminal. Después generá el QR de reportes desde **Datos y respaldos**. El celular no recibe permisos para administrar ventas, clientas, inventario ni la base.

Esta propuesta no inicia sesión en Treinta ni sincroniza su cuenta. La migración continúa mediante CSV/Excel con mapeo de las columnas del archivo real. No se reutilizan el nombre comercial, las imágenes ni los recursos visuales de Treinta.

La guía general de [instalación y uso local](web-local.md) explica los respaldos, el firewall de red privada y las limitaciones del acceso móvil. Los archivos `.cmd` requieren una comprobación en Windows real; la validación automatizada del motor y de la selección de vista se realiza por separado.
