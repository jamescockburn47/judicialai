@echo off
:: BS Detector Launcher — double-click to start
:: Runs the PowerShell launcher with execution policy bypass
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"
pause
