# Sou Linda System · Beta 1 (0.5.1-beta.1)

Preparada el 29 de octubre de 2026 para evaluar el flujo de una lencería paraguaya con datos ficticios en guaraníes. El ZIP para probar contiene el motor Python y la interfaz compilada; no necesita Node.js. Requiere Python 3.12 o posterior. La primera instalación descarga dependencias; después el motor funciona sin Internet en la notebook.

## Inicio y separación de datos

| Aspecto | Edición normal | Beta |
| --- | --- | --- |
| Acceso Windows | Iniciar-Sou-Linda-System.cmd | Probar-Sou-Linda-Beta.cmd |
| Carpeta Windows por defecto | %LOCALAPPDATA%\SouLindaSystem | %LOCALAPPDATA%\SouLindaSystemBeta |
| Puerto local | 8765 | 8766 |
| Vista inicial | Clásica | Ágil |
| Cookie de sesión | sadi_session | sadi_beta_session |
| Carga inicial | Base vacía | 22 pedidos, 4 clientas y catálogo ficticio |

`server/run.py --beta` selecciona esos valores predeterminados. Para desarrollo, `--data-dir`, `--port` y `--view` permiten una prueba descartable explícita. La beta rechaza la carpeta normal, sus alias y enlaces a la base o auxiliares de SQLite antes de adquirir el bloqueo. También rechaza una base existente sin identificación compatible de beta.

El archivo externo `sou-linda-beta.json` identifica el entorno y registra si se completó la carga inicial. La carga de ejemplos es transaccional; una interrupción no deja media demo y una interrupción al escribir la marca puede recuperarse sin duplicar registros. La marca externa sobrevive a restauraciones y limpiezas. Reiniciar conserva las modificaciones y no vuelve a sembrar una base vaciada por la usuaria.

El estado `runtime_mode` se proyecta desde el servidor en `/api/snapshot`. No se guarda en el respaldo y un metadato restaurado no puede cambiarlo. Ambas vistas muestran el aviso **BETA DE PRUEBA**, incluso después de restaurar o vaciar la demo. Las sesiones independientes evitan que las cookies de dos puertos se sobrescriban.

## Funciones disponibles

La beta utiliza el mismo motor de inventario, CPP y finanzas: variantes por talle/color, reservas y cancelaciones, ventas, cobros, descuentos, comisiones, envío, packaging, fiado, clientas, gastos, caja diaria, rentabilidad mensual y comparación de canales. Incluye importación CSV/XLSX con mapeo y respaldos JSON/SQLite; la restauración interactiva usa JSON validado. Reservar no reconoce ingreso, costo ni cobro; completar conserva el costo histórico.

El acceso `Probar-Beta-Con-Celular.cmd` habilita los reportes móviles de solo lectura en la misma Wi-Fi, con vinculación y revocación desde la notebook. El motor debe permanecer abierto. No hay sincronización remota del negocio.

## Verificación de esta entrega

- Backend: **211 pruebas correctas** de dominio, finanzas, moneda, API, respaldos y lanzador, incluidas las comprobaciones nuevas de aislamiento, carga única y sesiones.
- Frontend: **20 pruebas correctas**, TypeScript y compilación Vite/PWA correctos.
- Chromium: **13 comprobaciones** de la beta, sin errores JavaScript: inicio automático PYG, ambos avisos beta, filtro talle/color, borrador compartido, reserva, cancelación, reportes, descarga JSON, restauración y vaciado explícito.
- ZIP extraído en una carpeta nueva: autotest financiero correcto, servidor HTTP real, interfaz disponible y 22 pedidos iniciales. Una clienta ficticia agregada se conservó tras reiniciar, sin duplicar pedidos.
- Paquete revisado: sin bases del negocio, credenciales, entornos Python, Node.js ni cachés de desarrollo.

Las pruebas se ejecutaron con Python 3.12 y Chromium en Linux. Los accesos `.cmd` y las rutas de Windows fueron revisados y sus valores simulados en tests; **falta probar la ejecución en Windows real**, además del firewall y Wi-Fi del equipo de la tienda. La suite emite una advertencia de deprecación de TestClient/httpx sin afectar los resultados.

El sitio no está publicado en Sites. GitHub aloja el código, las capturas y la descarga; la aplicación se ejecuta localmente. El comprobante es interno y no reemplaza la facturación fiscal.

## Repetir las verificaciones

Desde el proyecto completo, ejecutá `npm test`, `npm run build` y `server/.venv/bin/python -m pytest server/tests`. El lanzador ofrece `--self-test` con una base temporal.

Para el recorrido de navegador, iniciá `server/.venv/bin/python server/run.py --beta --no-browser --data-dir /tmp/sou-linda-beta-prueba` y ejecutá `node tests-browser/beta.mjs`. Esta prueba termina vaciando explícitamente la demo: debe apuntar únicamente a una carpeta descartable nueva. Las guardias de modo beta/demo/PYG se comprueban antes de modificar datos.

`python scripts/package_beta.py` genera el ZIP de prueba con los archivos necesarios para usarlo. `python scripts/package_web.py` genera un ZIP separado con fuentes, pruebas y herramientas de desarrollo; no reemplaza el paquete 0.5.0 conservado.
