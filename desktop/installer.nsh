; Smart Hospital setup: extra steps around electron-builder's NSIS installer (see scripts/build-windows.mjs).
; The server parts live in $INSTDIR\resources\sh; the desktop app sets them up on first run (Server).

; Upgrade or uninstall: stop the server's database and web server so their files can be replaced or removed.
; A real uninstall also removes the services; the hospital's data in %ProgramData%\SmartHospital is kept.
!macro customUnInstall
  IfFileExists "$INSTDIR\resources\sh\bin\services.cmd" 0 shDone
    ${if} ${isUpdated}
      nsExec::Exec '"$INSTDIR\resources\sh\bin\services.cmd" stop'
    ${else}
      nsExec::Exec '"$INSTDIR\resources\sh\bin\services.cmd" uninstall'
    ${endif}
    Pop $0
  shDone:
!macroend

; This PC was already set up as the server: start it again with the new version.
!macro customInstall
  ReadEnvStr $1 ProgramData
  IfFileExists "$1\SmartHospital\config.env" 0 shSkip
    DetailPrint "Starting the Smart Hospital server…"
    nsExec::Exec '"$INSTDIR\resources\sh\bin\services.cmd" install'
    Pop $0
  shSkip:
!macroend
