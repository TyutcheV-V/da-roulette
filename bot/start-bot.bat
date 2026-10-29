@echo off
cd /d "%~dp0"
node --env-file=.env index.js
echo.
echo Бот остановился (или упал с ошибкой) — смотри сообщение выше.
pause
