@echo off
rem services.cmd install ^| uninstall ^| stop — run by the setup as administrator.
rem   Database: Windows service "SmartHospitalDB" (MongoDB on 127.0.0.1 only).
rem   Web server (and optional HTTPS proxy): scheduled tasks that start at boot as SYSTEM.
setlocal
for %%i in ("%~dp0..") do set "ROOT=%%~fi"
set "DATA=%ProgramData%\SmartHospital"
set "PORT=3010"
for /f "usebackq tokens=1,* delims==" %%a in ("%DATA%\config.env") do if "%%a"=="PORT" set "PORT=%%b"

if /i "%~1"=="install" goto install
if /i "%~1"=="uninstall" goto uninstall
if /i "%~1"=="stop" goto stop
echo Usage: services.cmd install ^| uninstall ^| stop
exit /b 1

:stop
schtasks /end /tn "SmartHospital\Server" > nul 2>&1
schtasks /end /tn "SmartHospital\Proxy" > nul 2>&1
powershell -NoProfile -Command "Get-Process node,caddy -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '%ROOT%\*' } | Stop-Process -Force" > nul 2>&1
net stop SmartHospitalDB > nul 2>&1
exit /b 0

:install
call :stop
"%ROOT%\mongodb\mongod.exe" --remove --serviceName SmartHospitalDB > nul 2>&1
"%ROOT%\mongodb\mongod.exe" --config "%DATA%\mongod.cfg" --install --serviceName SmartHospitalDB --serviceDisplayName "Smart Hospital Database"
sc config SmartHospitalDB start= auto > nul
net start SmartHospitalDB
schtasks /create /tn "SmartHospital\Server" /tr "\"%ROOT%\bin\start-server.cmd\"" /sc onstart /ru SYSTEM /rl HIGHEST /f > nul
schtasks /run /tn "SmartHospital\Server" > nul
if exist "%ROOT%\caddy\caddy.exe" (
  schtasks /create /tn "SmartHospital\Proxy" /tr "\"%ROOT%\bin\start-proxy.cmd\"" /sc onstart /ru SYSTEM /rl HIGHEST /f > nul
  schtasks /run /tn "SmartHospital\Proxy" > nul
  netsh advfirewall firewall delete rule name="Smart Hospital HTTPS" > nul 2>&1
  netsh advfirewall firewall add rule name="Smart Hospital HTTPS" dir=in action=allow protocol=TCP localport=80,443 > nul
)
rem Staff workstations on the hospital network open http://this-pc:PORT
netsh advfirewall firewall delete rule name="Smart Hospital" > nul 2>&1
netsh advfirewall firewall add rule name="Smart Hospital" dir=in action=allow protocol=TCP localport=%PORT% > nul
exit /b 0

:uninstall
call :stop
schtasks /delete /tn "SmartHospital\Server" /f > nul 2>&1
schtasks /delete /tn "SmartHospital\Proxy" /f > nul 2>&1
"%ROOT%\mongodb\mongod.exe" --remove --serviceName SmartHospitalDB > nul 2>&1
netsh advfirewall firewall delete rule name="Smart Hospital" > nul 2>&1
netsh advfirewall firewall delete rule name="Smart Hospital HTTPS" > nul 2>&1
rem The hospital's data in %ProgramData%\SmartHospital is kept.
exit /b 0
