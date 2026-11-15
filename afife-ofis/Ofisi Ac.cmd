@echo off
chcp 65001 >nul
title Afife Ofisi
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js bulunamadi. Claude uygulamasina "ofisi kur" deyin. & pause & exit /b 1)
set "NF="
node --use-system-ca -e "" >nul 2>nul && set "NF=--use-system-ca"
node %NF% server.js --ac
pause
