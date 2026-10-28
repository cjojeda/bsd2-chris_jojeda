@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
set "PYTHONUTF8=1"
set "SOU_PYTHON="

if not exist "server\run.py" goto :missing_files
if not exist "dist\index.html" goto :missing_build

if exist "server\.venv\Scripts\python.exe" goto :check_environment

py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)" >nul 2>&1
if not errorlevel 1 set "SOU_PYTHON=py -3"
if defined SOU_PYTHON goto :create_environment
python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)" >nul 2>&1
if not errorlevel 1 set "SOU_PYTHON=python"
if not defined SOU_PYTHON goto :missing_python

:create_environment
echo Preparando Sou Linda System. Esta primera instalacion requiere Internet.
%SOU_PYTHON% -m venv "server\.venv"
if errorlevel 1 goto :failed

:check_environment
"server\.venv\Scripts\python.exe" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)" >nul 2>&1
if errorlevel 1 goto :invalid_environment
if not exist "server\.venv\.sou-requirements-installed" goto :install_dependencies
fc /b "server\requirements.txt" "server\.venv\.sou-requirements-installed" >nul 2>&1
if errorlevel 1 goto :install_dependencies
"server\.venv\Scripts\python.exe" -c "import fastapi, uvicorn, openpyxl, qrcode" >nul 2>&1
if errorlevel 1 goto :install_dependencies
goto :run

:install_dependencies
echo Instalando componentes de Python. Esto se repite solo si cambian o faltan.
"server\.venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r "server\requirements.txt"
if errorlevel 1 goto :failed
copy /y "server\requirements.txt" "server\.venv\.sou-requirements-installed" >nul
if errorlevel 1 goto :failed

:run
echo Sou Linda System utiliza la base guardada en esta notebook.
echo Deja esta ventana abierta mientras trabajas. Para cerrar el motor, presiona Ctrl+C.
"server\.venv\Scripts\python.exe" "server\run.py" %*
if errorlevel 1 goto :failed
exit /b 0

:missing_python
echo Instala Python 3.12 o posterior de https://www.python.org/downloads/windows/
echo Durante la instalacion activa el lanzador de Python o la opcion Add Python to PATH.
echo Luego vuelve a abrir este archivo.
goto :stop

:invalid_environment
echo El entorno de Python esta incompleto o utiliza una version anterior a 3.12.
echo Cierra Sou Linda System y elimina solo la carpeta server\.venv de esta instalacion.
echo Vuelve a abrir este archivo para reconstruirla. La base del negocio se guarda aparte.
goto :stop

:missing_files
echo Falta server\run.py. Extrae el paquete completo en una carpeta antes de iniciar.
goto :stop

:missing_build
echo Falta la interfaz compilada dist\index.html.
echo Usa el paquete de entrega completo. En desarrollo ejecuta npm ci y npm run build.
goto :stop

:failed
echo No se pudo completar la operacion. Revisa el error que aparece arriba.
echo La base de datos del negocio no se borra al reinstalar los componentes.

:stop
pause
exit /b 1
