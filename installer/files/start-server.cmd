@echo off
rem Smart Hospital web server. Started at boot by the "SmartHospital\Server" scheduled task
rem (as SYSTEM, without a window); restarts the server if it ever stops.
setlocal
for %%i in ("%~dp0..") do set "ROOT=%%~fi"
set "DATA=%ProgramData%\SmartHospital"
cd /d "%ROOT%\app"
:loop
"%ROOT%\runtime\node.exe" --env-file="%DATA%\config.env" server.js >> "%DATA%\logs\server.log" 2>&1
timeout /t 5 /nobreak > nul
goto loop
