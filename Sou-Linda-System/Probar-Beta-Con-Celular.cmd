@echo off
setlocal EnableExtensions
title Sou Linda System - Beta y reportes en celular
echo Sou Linda System - BETA DE PRUEBA EN GUARANIES
echo Notebook y celular deben estar en la misma red Wi-Fi.
call "%~dp0scripts\Iniciar-motor.cmd" --beta --view agile --mobile %*
exit /b %errorlevel%
