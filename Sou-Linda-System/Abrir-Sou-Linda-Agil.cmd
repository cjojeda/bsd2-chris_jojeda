@echo off
setlocal EnableExtensions
call "%~dp0scripts\Iniciar-motor.cmd" --view agile %*
exit /b %errorlevel%
