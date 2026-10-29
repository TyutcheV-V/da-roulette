@echo off
cd /d "%~dp0"
pm2.cmd start ecosystem.config.js
echo.
echo Бот запущен в фоне — можно закрыть это окно, он продолжит работать.
pause
