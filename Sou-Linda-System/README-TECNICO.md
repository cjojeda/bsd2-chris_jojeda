# Sou Linda System

Aplicación web para administrar una lencería desde la notebook, con **Python y SQLite local**. Incluye catálogo por modelo/talle/color, ventas, reservas, clientas, caja, costos, rentabilidad y respaldo completo. La interfaz se abre en Chrome o Edge; los datos del negocio se guardan en el disco de la notebook, fuera del navegador.

El celular puede consultar **reportes de solo lectura en la misma Wi-Fi**, cuando la notebook está encendida y el motor local está abierto. Este proyecto no sincroniza el negocio con una nube ni habilita acceso desde Internet.

## Dos vistas para elegir

**Sou Linda System** conserva la vista **Clásica** e incorpora la alternativa **Ágil**, orientada a las tareas del día: registrar ventas y gastos, revisar caja, stock por talle/color, fiados y reportes. Ambas comparten una única base local y el mismo motor financiero.

Para iniciar Ágil, abrí `Abrir-Sou-Linda-Agil.cmd`. También podés cambiar entre vistas desde la interfaz. El diseño toma como referencia funcional las [capacidades públicas de Treinta](docs/referencias-treinta.md), con la marca y la identidad visual de Sou Linda. La [guía de la alternativa](docs/alternativa-agil.md) explica los accesos y la comparación.

## Usar en Windows

Necesitás **Python 3.12 o posterior** y Chrome o Edge actualizados. El paquete de entrega incluye la interfaz compilada en `dist/`: no hace falta Node.js para usarlo.

1. Extraé el paquete completo en una carpeta de la notebook.
2. Abrí **`Iniciar-Sou-Linda-System.cmd`**. La primera vez crea un entorno de Python y descarga las dependencias; requiere Internet solo para esa instalación.
3. Se abre el navegador con Sou Linda System. Mantené abierta la ventana del motor mientras trabajás.
4. Al terminar, cerrá el motor con **Ctrl+C**.

Para ver reportes desde el teléfono, cerrá primero el motor y abrí **`Compartir-reportes-en-celular.cmd`**. En **Datos y respaldos → Reportes en tu celular**, generá el enlace o QR y abrilo desde Chrome en el teléfono conectado a la misma Wi-Fi. La notebook conserva el control de ventas, inventario, clientas y respaldos. El arqueo diario y los movimientos por medio de pago se consultan en la notebook; el celular recibe reportes mensuales agregados.

La [guía de uso e instalación](docs/web-local.md) explica el acceso móvil, los respaldos y la recuperación. El comprobante emitido es interno y no reemplaza una factura fiscal.

## Qué incluye

| Módulo | Funciones |
| --- | --- |
| Inventario | Modelo, talle, color, SKU, precios minorista/mayorista, stock físico, reservado y disponible; compras, CPP y ajustes |
| Punto de venta | Búsqueda y filtros; descuentos fijos o porcentuales; Instagram, WhatsApp, TikTok o local; efectivo, transferencia, tarjeta, QR y crédito |
| Pedidos | Pendiente, reservado, completado y cancelado; cobros separados, devolución parcial, reembolso y costos directos |
| Finanzas | Costo de ventas histórico, comisiones, envío y packaging, gastos fijos/variables, arqueo diario y resultado mensual por canal |
| Clientas | Datos de contacto, talles preferidos, compras y saldos |
| Datos | Guardado transaccional, borrador del POS, backup JSON y SQLite, restauración JSON validada, importación/exportación CSV y Excel `.xlsx` |
| Celular | Reportes mensuales agregados con enlace revocable; sin edición ni acceso a datos personales de clientas |

## Reglas financieras

Los importes se guardan en **centavos enteros**. El costo promedio ponderado se calcula sobre el valor y las unidades del inventario; cada venta conserva el costo que tenía al completarse. Un descuento reduce el ingreso de la venta y su ganancia, sin reducir artificialmente el costo.

```text
Ingreso de venta = precio bruto − descuento
Ganancia real de venta = ingreso − costo histórico − comisiones − envío asumido − packaging
Ganancia neta del período = ingresos netos − costo de ventas − costos directos − gastos operativos − pérdidas de inventario
```

Las reservas reducen el stock **disponible**, conservando el físico y su valor hasta completar o liberar el pedido. Una devolución registra un movimiento compensatorio en su fecha y recupera el costo histórico; el reembolso de dinero es una operación separada. Las compras de stock afectan caja cuando se pagan y resultado cuando se vende la mercadería, evitando descontarlas dos veces.

La rentabilidad y el efectivo se calculan en libros separados: vender a crédito no inventa un cobro. Si una venta histórica importada no tiene costo conocido, el resultado se informa **incompleto**, no como si ese costo fuera cero.

## Respaldo y migración

El JSON completo permite restaurar la base en otra instalación. Antes de reemplazar datos, el servidor valida el esquema, las relaciones, el inventario y los libros financieros en una base temporal; además conserva una copia previa. Una copia en la misma notebook ayuda ante errores, pero también guardá un respaldo en otra unidad.

La importación muestra columnas y vista previa antes de confirmar. Admite CSV y `.xlsx` de hasta 10 MB y 20.000 filas, con mapeo explícito. Para migrar desde Treinta se necesita su exportación real: no se presupone un formato propietario ni una integración directa. Las ventas históricas no descuentan el inventario físico actual.

## Arquitectura y código

| Capa | Tecnología |
| --- | --- |
| Interfaz | React, TypeScript, Vite y CSS local |
| Motor local | Python 3.12+, FastAPI y Uvicorn, un proceso |
| Persistencia | `sqlite3` de Python, transacciones, claves foráneas y WAL |
| Excel | `openpyxl`; CSV con la biblioteca estándar |
| Aplicación instalable | Caché de archivos estáticos mediante service worker en contextos compatibles |
| Verificación | Pytest para dominio/API e infraestructura de pruebas del frontend |

```text
server/run.py                 Inicio del motor en la notebook
server/src/sadi_local/
  schema.sql                  Esquema ejecutado por SQLite
  db.py                       Conexión y transacciones
  services.py                 Pedidos, CPP, cobros y operaciones
  reports.py                  Rentabilidad, caja y cierres
  transfer.py                 Validación e intercambio de datos
  web.py                      API local y autorización móvil
  web_transfer.py             Backup e importaciones por la web
src/
  pages/                      POS, inventario, pedidos, clientas, finanzas y respaldos
  data/                       Cliente de API, reportes e intercambio
  domain/                     Contratos de interfaz y servicios
scripts/                      Inicio y preparación en Windows
docs/architecture-web.md       Arquitectura vigente y relaciones
```

El [esquema SQL ejecutado](server/src/sadi_local/schema.sql) y la [arquitectura actual](docs/architecture-web.md) son las referencias de esta versión. `desktop/` conserva el trabajo previo con Qt y los documentos iniciales en `docs/` describen etapas anteriores; no son necesarios para ejecutar esta entrega web. Esta versión no utiliza IndexedDB como base del negocio.

## Desarrollo

Node.js 22.12 o posterior se usa únicamente para compilar la interfaz:

```bash
npm ci
npm run build
python -m venv server/.venv
server/.venv/bin/python -m pip install -r server/requirements-dev.txt
server/.venv/bin/python server/run.py --no-browser
```

En Windows, el intérprete del entorno es `server\.venv\Scripts\python.exe`. En otra terminal, `npm run dev` inicia la interfaz de desarrollo y deriva `/api` al motor local. La versión para uso diario sirve `dist/` desde Python y utiliza un único origen.

Pruebas del backend:

```bash
cd server
.venv/bin/python -m pytest
```

Instalar la interfaz como PWA agrega un acceso directo y caché de archivos estáticos. **El motor de Python debe seguir abierto** para leer o modificar datos, incluso sin Internet. En el teléfono mediante HTTP de red local no se garantiza la instalación PWA ni la disponibilidad de service worker.

La base y los respaldos no están cifrados por esta aplicación. El acceso móvil comparte datos agregados mediante un enlace privado y revocable sobre la red local; usalo en una Wi-Fi de confianza. No abras puertos del router para acceder desde afuera.

No se ha publicado un sitio en Sites ni creado un repositorio remoto desde esta entrega: esas integraciones no estuvieron disponibles. El proyecto queda listo para ejecución local y revisión.
