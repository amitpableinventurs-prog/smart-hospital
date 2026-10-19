@echo off
rem Optional HTTPS for a custom domain: Caddy gets a certificate for DOMAIN (from config.env)
rem automatically and forwards to the app. Needs the domain's DNS pointing here and ports 80/443 open.
setlocal
for %%i in ("%~dp0..") do set "ROOT=%%~fi"
set "DATA=%ProgramData%\SmartHospital"
set "DOMAIN="
set "PORT=3010"
for /f "usebackq tokens=1,* delims==" %%a in ("%DATA%\config.env") do (
  if "%%a"=="DOMAIN" set "DOMAIN=%%b"
  if "%%a"=="PORT" set "PORT=%%b"
)
if "%DOMAIN%"=="" exit /b 0
if not exist "%ROOT%\caddy\caddy.exe" exit /b 0
:loop
"%ROOT%\caddy\caddy.exe" reverse-proxy --from "%DOMAIN%" --to "127.0.0.1:%PORT%" >> "%DATA%\logs\proxy.log" 2>&1
timeout /t 10 /nobreak > nul
goto loop
