# Fuentes de plataformas consultadas

Documentación oficial revisada para la arquitectura de **Sou Linda System**, el 27 de octubre de 2026. Las copias de los documentos consultados y el registro de obtención están en [`platform-sources/`](platform-sources/) y [`sources.json`](platform-sources/sources.json). Las ramas de los repositorios pueden cambiar; las copias locales permiten revisar qué contenido se consultó.

| Plataforma y fuente | Hecho documentado | Decisión aplicada |
| --- | --- | --- |
| [Python 3.12: `sqlite3.Connection.backup`](https://docs.python.org/3.12/library/sqlite3.html#sqlite3.Connection.backup) | La API crea una copia de la base y funciona incluso con otros clientes accediendo a ella. | Exportaciones SQLite y snapshots usan `Connection.backup`; no se copia a mano el archivo principal con WAL activo. |
| [Starlette: TrustedHostMiddleware](https://www.starlette.io/middleware/#trustedhostmiddleware) | Valida el encabezado `Host` y rechaza hosts no autorizados. | El motor admite los hosts locales y direcciones de red configurados; no abre una lista comodín de dominios. Esta validación se combina con comprobación de origen y permisos. |
| [FastAPI: primeros pasos de seguridad](https://fastapi.tiangolo.com/tutorial/security/first-steps/) | La autenticación Bearer envía un token en el encabezado `Authorization`. | El reporte móvil exige `Authorization: Bearer …`. Es un permiso local y revocable de lectura; no se implementa un servidor OAuth ni se atribuye esa función al uso del encabezado. |
| [MDN: Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) | Los service workers requieren contextos seguros; los navegadores tratan `http://localhost` como seguro para desarrollo local. | La PWA puede instalar/cachear interfaz en contextos compatibles de la notebook. No se promete instalación PWA sobre una IP local del celular por HTTP. El motor sigue siendo necesario para los datos. |
| [MDN: `showDirectoryPicker`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker) | Es una capacidad de contexto seguro, con compatibilidad limitada, permiso y activación del usuario. | La persistencia no depende de que el navegador pueda abrir una carpeta. Python escribe la base local; el navegador descarga backups y selecciona archivos mediante controles estándar. |

La página independiente de contextos seguros registrada en `sources.json` devolvió **404** y no se utiliza como evidencia. La regla sobre HTTPS y `localhost` se verificó en la página de Service Worker API descargada correctamente.

## Alcance de las conclusiones

Estas fuentes respaldan capacidades de las plataformas; no certifican la seguridad del producto ni reemplazan las pruebas de su implementación. Las restricciones específicas de administración local, CSRF, origen, proyección agregada, token revocable y transacciones se verifican en el código y sus pruebas.

La documentación de FastAPI muestra un flujo OAuth de ejemplo. Sou Linda System no necesita ese flujo para su caso de una notebook: usa sesión administrativa local y un token independiente de reportes. Del mismo modo, CORS no se utiliza como sustituto de autenticación.

No se consultó una exportación real de la cuenta Treinta de la usuaria ni se afirma disponer de una API de Treinta. El importador utiliza CSV/Excel con mapeo explícito y vista previa; la correspondencia definitiva se debe comprobar sobre el archivo que se migre.
