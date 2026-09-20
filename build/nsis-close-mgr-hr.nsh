; Manager & Supervisor Portal — close running apps before install/upgrade so NSIS does not hang on "Installing".

!include "nsProcess.nsh"

!macro _SHOPPOS_KILL_IM _IM
  nsExec::ExecToLog 'taskkill /F /IM "${_IM}" /T'
  Pop $R9
  ${nsProcess::KillProcess} "${_IM}" $R9
!macroend

!macro _SHOPPOS_KILL_MGRHR
  !insertmacro _SHOPPOS_KILL_IM "ManagerSupervisorPortal.exe"
  !insertmacro _SHOPPOS_KILL_IM "Manager Supervisor Portal.exe"
  !insertmacro _SHOPPOS_KILL_IM "ShopPOS-ManagerSupervisorPortal-Portable.exe"
  !insertmacro _SHOPPOS_KILL_IM "ShopPOS-ManagerSupervisorPortal-Setup.exe"
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $$_.ProcessName -match ''ManagerSupervisor|Manager.Supervisor'' } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $R9
  Sleep 600
!macroend

!macro customInit
  !insertmacro _SHOPPOS_KILL_MGRHR
  Sleep 400
  !insertmacro _SHOPPOS_KILL_MGRHR
!macroend

!macro customCheckAppRunning
  DetailPrint "Closing Manager Supervisor Portal if running..."
  !insertmacro _SHOPPOS_KILL_MGRHR
  Sleep 800
  !insertmacro _SHOPPOS_KILL_MGRHR
  Sleep 400
!macroend
