@echo off
title Shop POS
cd /d "%~dp0"
if exist node_modules\electron (
  npm start
) else (
  echo Installing dependencies first...
  call npm install
  npm start
)
