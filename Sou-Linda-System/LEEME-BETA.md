# Sou Linda System · Beta 1

Beta de prueba para una lencería de Paraguay. Se abre en Chrome o Edge, usa **guaraníes (PYG, ₲)** y carga automáticamente productos, clientas, pedidos y gastos ficticios al iniciar por primera vez.

## Abrir en Windows

1. Instalá [Python 3.12 o posterior](https://www.python.org/downloads/windows/) si todavía no lo tenés. Habilitá su lanzador o la opción **Add Python to PATH**.
2. Extraé **todo** el ZIP en una carpeta. No abras los archivos desde dentro del ZIP.
3. Hacé doble clic en **Probar-Sou-Linda-Beta.cmd**.
4. La primera ejecución descarga las dependencias Python. Esperá a que se abra el navegador y conservá abierta la ventana del motor.
5. Para terminar, presioná **Ctrl+C** en esa ventana. Tus cambios de prueba se conservan para la próxima vez.

La interfaz ya viene compilada. No necesitás Node.js ni crear productos para empezar a probar. La descarga inicial necesita Internet; el uso normal en la notebook funciona sin Internet cuando el motor está abierto.

## Qué probar en cinco minutos

- En **Registrar venta**, elegí modelo, talle y color. Cambiá canal y medio de pago, aplicá un descuento y completá la venta.
- Probá **Reservar stock** y después cancelá el pedido desde Ventas y pedidos para revisar la disponibilidad.
- Registrá un gasto desde Inicio y revisalo en **Caja diaria** y **Reportes**.
- Consultá los talles, precios minorista/mayorista y alertas de **Productos**.
- Cambiá entre las vistas **Ágil** y **Clásica**; ambas usan los mismos datos de esta beta.
- Descargá un respaldo JSON desde **Datos y respaldos**. Si querés probar su recuperación, la restauración reemplaza únicamente los datos de esta beta.

Los precios se muestran como **₲ 50.000**, sin decimales. Los porcentajes pueden llevar dos decimales. En un precio o gasto escribí `50000`, sin separador de miles.

## Datos de prueba separados

La beta usa normalmente **%LOCALAPPDATA%\SouLindaSystemBeta**, el puerto **8766** y una marca visible **BETA DE PRUEBA**. La edición normal usa otra carpeta y el puerto 8765. La beta tiene su propia sesión del navegador, de modo que ambas pueden estar abiertas a la vez.

Los ejemplos se cargan una sola vez. Volver a iniciar la beta conserva tus pedidos y cambios. Si vaciás la demo desde Datos y respaldos, no se vuelve a cargar automáticamente al reiniciar; podés cargarla otra vez con **Explorar demo** en una base vacía.

La carpeta beta guarda un archivo `sou-linda-beta.json` que la identifica como entorno de prueba. No lo borres mientras usás la beta. El lanzador rechaza la carpeta de datos normal y las bases existentes sin esa identificación.

## Reportes desde el celular

Cerrá el motor de la beta y abrí **Probar-Beta-Con-Celular.cmd**. Desde la notebook, generá un QR en **Datos y respaldos → Reportes en tu celular**. El celular y la notebook deben estar en la misma Wi-Fi. El teléfono consulta reportes de solo lectura y la notebook debe permanecer encendida.

## Si no abre

- Verificá que hayas extraído el ZIP completo y que Python 3.12 o posterior esté instalado.
- Si falló la primera descarga, revisá Internet y el error de la ventana antes de volver a abrir el acceso.
- Si indica que ya está abierto, usá la ventana existente o cerrá ese motor con Ctrl+C.
- Si el puerto 8766 está ocupado, cerrá el otro proceso de prueba. No borres la base del negocio para resolverlo.
- Si detectás un problema, conservá el texto del error y anotá qué estabas haciendo para poder revisarlo.

Esta es una beta para evaluar el flujo de trabajo. Las pruebas automatizadas y de navegador se realizan en Linux; los accesos `.cmd` también necesitan probarse en Windows real. No incluye facturación fiscal automática ni una publicación en Sites.
