@echo off
cd /d "%~dp0"
pm2.cmd stop sonechka-bot
echo.
echo Бот остановлен (отключён от чата).
pause
