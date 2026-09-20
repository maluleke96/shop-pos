; Referral / Referral Commission — close running apps before install/upgrade.
; Cause of "Referral Commission cannot be closed... Retry":
; electron-builder only kills PRODUCT_FILENAME.exe (ReferralCommission.exe).
; Older builds used "Referral Commission.exe" / "Referral & Commission.exe",
; which stay running, lock files in $INSTDIR, and trigger this dialog.

!include "nsProcess.nsh"

!macro _SHOPPOS_KILL_IM _IM
  nsExec::ExecToLog 'taskkill /F /IM "${_IM}" /T'
  Pop $R9
  ${nsProcess::KillProcess} "${_IM}" $R9
!macroend

!macro _SHOPPOS_KILL_ALL_REFERRAL
  ; Current executableNames
  !insertmacro _SHOPPOS_KILL_IM "ReferralCommission.exe"
  !insertmacro _SHOPPOS_KILL_IM "ReferralAgent.exe"
  ; Older productName-based filenames (spaces / &)
  !insertmacro _SHOPPOS_KILL_IM "Referral Commission.exe"
  !insertmacro _SHOPPOS_KILL_IM "Referral Agent.exe"
  !insertmacro _SHOPPOS_KILL_IM "Referral & Commission.exe"
  !insertmacro _SHOPPOS_KILL_IM "Referral&Commission.exe"
  ; Portable leftovers
  !insertmacro _SHOPPOS_KILL_IM "ShopPOS-ReferralCommission-Portable.exe"
  !insertmacro _SHOPPOS_KILL_IM "ShopPOS-ReferralAgent-Portable.exe"
  ; PowerShell fallback ($$ = literal $ for NSIS)
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $$_.ProcessName -match ''Referral'' } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $R9
  Sleep 800
!macroend

!macro customInit
  !insertmacro _SHOPPOS_KILL_ALL_REFERRAL
  Sleep 500
  !insertmacro _SHOPPOS_KILL_ALL_REFERRAL
!macroend

; Replace electron-builder default check so upgrades don't stall on old exe names
!macro customCheckAppRunning
  DetailPrint "Closing Referral / Referral Commission if running..."
  !insertmacro _SHOPPOS_KILL_ALL_REFERRAL
  Sleep 1000
  !insertmacro _SHOPPOS_KILL_ALL_REFERRAL
  Sleep 500
!macroend
