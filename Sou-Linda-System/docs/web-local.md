# Sou Linda System: uso en la notebook y el celular

La notebook guarda el negocio. Chrome o Edge muestran la interfaz, y un pequeño motor local de Python lee y escribe una base SQLite en el disco. Una vez instalados los componentes, las operaciones normales no requieren Internet; enviar un recibo por WhatsApp sí utiliza la conexión y la cuenta correspondiente.

## Primera instalación en Windows

1. Instalá [Python 3.12 o posterior para Windows](https://www.python.org/downloads/windows/). Durante la instalación, habilitá el lanzador de Python o la opción para agregarlo a `PATH`.
2. Extraé **todo** el paquete Sou Linda System en una carpeta. No ejecutes los archivos desde dentro del ZIP.
3. Abrí `Iniciar-Sou-Linda-System.cmd`. La primera ejecución crea `server\.venv` y descarga FastAPI, Uvicorn, openpyxl y qrcode. No instala Qt, Electron ni una base de datos externa.
4. Esperá a que se abra el navegador. Conservá abierta la ventana del motor.
5. Para cerrar, presioná **Ctrl+C** en esa ventana.

El paquete de entrega lleva la interfaz ya compilada en `dist/`. Si trabajás desde el código fuente y esa carpeta falta, es necesario ejecutar `npm ci` y `npm run build` con Node.js 22.12 o posterior antes de iniciar.

La descarga inicial de dependencias requiere Internet. Los inicios siguientes reutilizan el entorno; el instalador solo vuelve a descargar si cambia `server/requirements.txt` o faltan componentes.

## Dónde quedan los datos

En una instalación Windows normal, la carpeta del negocio es:

```text
%LOCALAPPDATA%\SouLindaSystem\
  sou-linda.sqlite3 Base del negocio
  backups\         Copias locales automáticas y anteriores a restauraciones
  web-auth.json    Hash del permiso móvil; no contiene el token en texto plano
```

Si se inicia con `--data-dir`, esa carpeta explícita reemplaza la ubicación predeterminada. Los identificadores internos del formato de backup se conservan para poder validar copias compatibles.

No copies una base SQLite abierta arrastrando solo `sou-linda.sqlite3`: puede tener información reciente en su archivo WAL. Usá **Datos y respaldos → Copia SQLite** o **Descargar respaldo JSON**, que generan copias consistentes. No borres los archivos auxiliares `-wal`, `-shm` o `-journal` mientras el motor está abierto.

La ventana del navegador se puede cerrar sin borrar la base. Borrar la caché del navegador tampoco elimina el negocio, aunque puede quitar la instalación PWA o preferencias de interfaz. Al cambiar de Windows, de notebook o formatear, restaurá un backup; no dependas de conservar la carpeta de instalación.

## Primeros pasos de negocio

1. En **Inventario**, creá el modelo y cada combinación de talle y color. Asigná SKU, precios minorista/mayorista y mínimo de stock.
2. Registrá el stock inicial con su costo. Las siguientes compras se cargan como entradas para que el CPP se recalcule con el valor real.
3. En **Clientas**, guardá contactos y talles preferidos. Una venta a crédito exige una clienta para mantener el saldo.
4. En **Punto de venta**, buscá y filtrá variantes, armá el carrito y elegí canal, medio de pago y descuento. Agregá comisión y costos de envío/packaging asumidos por el negocio.
5. Elegí guardar pendiente, reservar o completar. El costo definitivo se toma del inventario al completar; el costo mostrado para un pedido aún abierto es una estimación.
6. En **Finanzas**, registrá gastos operativos, revisá el resultado mensual y realizá el arqueo de caja.
7. Descargá un respaldo y conservá una copia fuera de la notebook.

No vuelvas a registrar como gasto operativo un envío, packaging o comisión que ya está asociado a la venta. Eso duplicaría su descuento en el resultado.

## Pedidos, stock y dinero

| Operación | Stock | Resultado | Caja |
| --- | --- | --- | --- |
| Pendiente | No aparta unidades | No reconoce la venta | Sin cobro automático |
| Reservar | Aparta disponible; físico y valor se conservan | No reconoce la venta | Sin cobro automático |
| Completar | Consume unidades y costo CPP | Reconoce venta, costo y costos directos | Registra el cobro si corresponde; crédito queda pendiente |
| Cancelar pendiente/reserva | Libera la reserva | Sin venta completada | No crea dinero |
| Devolver una venta completada | Repone unidades con costo histórico | Compensa ingreso y costo en la fecha de devolución | El reembolso se registra aparte |
| Cobrar crédito | No cambia stock | No duplica facturación | Ingresa dinero por el medio elegido |

Los cobros a clientas, los pagos de gastos y los pagos de compras son hechos separados del reconocimiento de la venta o el gasto. Esta separación permite que el arqueo muestre dinero real y el reporte mensual muestre rentabilidad.

## Reportes desde Chrome en el celular

1. Cerrá el motor normal con **Ctrl+C**.
2. Abrí `Compartir-reportes-en-celular.cmd` en la notebook.
3. Conectá notebook y teléfono a la **misma Wi-Fi de confianza**. Evitá una red de invitados que aísle los dispositivos.
4. En la notebook, abrí **Datos y respaldos → Reportes en tu celular** y generá el acceso.
5. Escaneá el QR o copiá el enlace privado y abrilo en Chrome del teléfono.
6. Elegí el mes para consultar sus reportes. La notebook y el motor deben permanecer encendidos.

El teléfono recibe resultados mensuales agregados: ventas, costo, gastos, ganancia, ventas diarias resumidas y rendimiento por canal. El arqueo diario y los movimientos de caja por medio de pago se consultan en la notebook. El celular no obtiene las pantallas de edición, la base completa, respaldos ni nombres o teléfonos de clientas. El token no se envía como parámetro del servidor: llega en el fragmento del enlace, se retira de la barra y se usa como autorización de lectura durante esa sesión.

Si generás otro enlace, el anterior deja de funcionar. **Revocar acceso** invalida también las sesiones móviles existentes. El enlace permite ver los reportes a quien lo tenga mientras siga válido; compartilo solo con quien deba consultarlos.

La modalidad predeterminada acepta administración únicamente desde la propia notebook. El modo móvil abre el puerto local a la red para reportes, pero mantiene esa restricción de administración. No confíes en abrir la pantalla completa desde la dirección IP del teléfono: no adquiere permisos administrativos.

### Si el teléfono no conecta

- Comprobá que el motor iniciado sea el de **Compartir reportes** y siga abierto.
- Comprobá que ambos equipos estén en la misma red y que la notebook no esté suspendida.
- Si cambió la dirección IP de la notebook, reiniciá el motor y generá un nuevo enlace.
- Si Windows pregunta por el acceso de Python a la red, permitilo únicamente en la **red privada** que usás para este fin. No es necesario habilitar redes públicas ni desactivar el firewall.
- Las redes de invitados y algunos routers impiden que dos dispositivos se comuniquen. Probá la red principal.
- Si el acceso fue revocado, generá otro enlace desde la notebook.

El acceso es local por HTTP, sin cifrado TLS. Usá una red confiable. No hay acceso fuera de la Wi-Fi, servidor en Internet, sincronización automática ni configuración de puertos del router. Para consulta desde otra ubicación se necesitaría diseñar un acceso seguro adicional.

## Instalar la interfaz como aplicación

En la notebook, Chrome o Edge pueden ofrecer **Instalar aplicación** al abrir el sitio local. El acceso directo inicia la interfaz, pero no enciende por sí mismo el motor Python: abrí primero el archivo `.cmd`.

La caché de la PWA almacena archivos de interfaz. Las respuestas de la API financiera no se guardan en la caché del service worker. Si el motor está cerrado, la interfaz informa que no puede conectar y no registra ventas en una base alternativa.

Las capacidades de instalación dependen del navegador y del contexto seguro. `localhost` tiene tratamiento especial para desarrollo local; una IP de la Wi-Fi sobre HTTP no ofrece necesariamente las mismas capacidades. Los reportes móviles funcionan como una página normal y no requieren instalar una PWA.

## Respaldar y recuperar

**Respaldo JSON** es la opción recomendada para recuperar desde la interfaz:

1. Abrí **Datos y respaldos** y elegí **Descargar respaldo JSON**.
2. Verificá el archivo descargado con fecha y hora. Guardalo también en otra unidad.
3. Para restaurar, elegí ese JSON en **Restaurar una copia**.
4. Revisá la validación y confirmá el reemplazo de la base actual.

El servidor valida versión, checksum, tipos, referencias, inventario y coherencia financiera en una base temporal. Solo después reemplaza los registros dentro de una transacción. Antes guarda una copia de seguridad de la base existente. Si la validación falla, no se reemplaza la base activa.

La **Copia SQLite** ofrece una copia consistente para resguardo técnico; el botón de restaurar de la interfaz admite JSON. No renombres un `.sqlite3` a `.json` ni edites un backup a mano.

El motor genera snapshots locales al iniciar y cerrar de forma normal, y conserva una cantidad limitada de copias automáticas. Esas copias no cubren la pérdida o el formateo del disco. Una interrupción eléctrica puede impedir la copia de cierre; cada operación confirmada ya se guarda por transacción en SQLite.

El permiso del celular no forma parte del backup del negocio. Después de restaurar en otra notebook, habilitá un enlace nuevo.

## Migrar desde Treinta o Excel

La aplicación no presupone una API de Treinta ni una posición fija de sus columnas. Exportá tus datos desde la plataforma que usás y trabajá con el archivo real.

1. Descargá una plantilla CSV desde **Datos y respaldos** para ver los campos de destino.
2. Elegí **Catálogo y stock inicial** o **Ventas históricas**.
3. Seleccioná el archivo CSV o `.xlsx` y relacioná cada encabezado con el campo de Sou Linda.
4. Conservá la misma **cuenta de origen** para futuras importaciones del mismo negocio. Junto con el identificador externo, permite detectar ventas repetidas.
5. Revisá errores, advertencias y vista previa. Corregí el archivo o su mapeo antes de confirmar.

Se admiten hasta **10 MB y 20.000 filas**. Los CSV pueden usar coma, punto y coma o tabulación y deben ser UTF-8. Usá importes como `1250,50` o `1250.50`, sin separador de miles. Usá fechas `AAAA-MM-DD` o `DD/MM/AAAA`. Convertí las fórmulas de Excel a valores antes de importar.

Las filas con el mismo identificador externo forman un documento de venta. Los costos y cargos de pedido no deben repetirse como si fueran cargos distintos por artículo. Revisá las advertencias de agrupación y las plantillas descargadas.

La venta histórica no consume el stock actual: importá o contá el inventario físico por separado. Si falta el costo histórico, la ganancia se muestra incompleta hasta contar con ese dato; no se toma el precio actual como costo de una venta pasada.

Las exportaciones CSV/Excel sirven para análisis. No reemplazan el backup completo de la base.

## Diagnóstico básico

| Mensaje o situación | Acción |
| --- | --- |
| No se encuentra Python | Instalá Python 3.12+ y habilitá su lanzador o `PATH` |
| Falló la descarga inicial | Revisá conexión y el error; volvé a abrir el `.cmd` sin borrar la base |
| Entorno de Python incompleto | Cerrá el motor, eliminá solo `server\.venv` y volvé a iniciar |
| Falta `dist/index.html` | Extraé el paquete completo o compilá la interfaz desde el código |
| El puerto ya está ocupado | Cerrá el otro motor; no ejecutes dos copias del negocio a la vez |
| El navegador no conecta | Conservá el motor abierto y usá la dirección que muestra su ventana |
| Ganancia pendiente o incompleta | Revisá costos faltantes en ventas importadas; no es una ganancia de cero |
| La venta no tiene stock | Revisá el disponible; otras reservas pueden haber apartado las unidades |

La aplicación no cifra la base ni los backups. Protegé la sesión de Windows y las copias. Esta entrega no incluye facturación fiscal, conciliación bancaria automática, sincronización multiusuario ni una publicación en Sites.
