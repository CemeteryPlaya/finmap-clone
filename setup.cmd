@echo off
call npm ci || exit /b 1
call npm run setup
