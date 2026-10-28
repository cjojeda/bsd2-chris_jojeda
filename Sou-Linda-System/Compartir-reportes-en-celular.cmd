@echo off
setlocal EnableExtensions
call "%~dp0scripts\Iniciar-motor.cmd" --mobile %*
exit /b %errorlevel%
