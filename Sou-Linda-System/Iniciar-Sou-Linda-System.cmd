@echo off
setlocal EnableExtensions
call "%~dp0scripts\Iniciar-motor.cmd" %*
exit /b %errorlevel%
