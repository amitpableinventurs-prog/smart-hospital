@echo off
rem setup-server.cmd --port=3010 [--domain=his.example.com] [--control-url=https://control.example.com]
rem Run as administrator by the desktop app when this PC is chosen as the server:
rem writes the settings (configure.mjs), then installs and starts the database and web server.
setlocal
for %%i in ("%~dp0..") do set "ROOT=%%~fi"
set "LOG=%ProgramData%\SmartHospital\logs\setup.log"
"%ROOT%\runtime\node.exe" "%~dp0configure.mjs" %*
if errorlevel 1 exit /b 1
call "%~dp0services.cmd" install >> "%LOG%" 2>&1
exit /b %errorlevel%
