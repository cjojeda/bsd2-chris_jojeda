@echo off
setlocal EnableExtensions
title Sou Linda System - Beta de prueba
echo Sou Linda System - BETA DE PRUEBA EN GUARANIES
echo Se abriran datos ficticios en una carpeta separada del negocio.
call "%~dp0scripts\Iniciar-motor.cmd" --beta --view agile %*
exit /b %errorlevel%
