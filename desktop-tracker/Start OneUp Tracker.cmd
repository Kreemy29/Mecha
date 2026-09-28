@echo off
rem Starts the OneUp desktop tracker in the background (it lives in the tray).
start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0OneUpTracker.ps1"
