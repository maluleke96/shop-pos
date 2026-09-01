; Shop POS NSIS helpers — upgrade-friendly install that preserves user data.
; Electron userData for productName "Shop POS" is typically:
;   $APPDATA\Shop POS

!include LogicLib.nsh
!include FileFunc.nsh

!macro customHeader
  !system 'echo Shop POS update-safe installer'
!macroend

!macro customInit
  ; Detect existing install / data and inform the user this is an UPDATE.
  StrCpy $0 "$APPDATA\Shop POS\data\shop-pos.db"
  IfFileExists "$0" 0 shoppos_no_existing_db
    MessageBox MB_OK|MB_ICONINFORMATION "Existing Shop POS installation detected.$\r$\n$\r$\nYour existing data will be preserved.$\r$\nA timestamped database backup will be created before the upgrade."
  shoppos_no_existing_db:
!macroend

!macro customInstall
  ; Backup live database before files are replaced (extra safety beyond app migration backup).
  StrCpy $0 "$APPDATA\Shop POS\data\shop-pos.db"
  IfFileExists "$0" 0 shoppos_skip_backup
    CreateDirectory "$APPDATA\Shop POS\data\backups"
    ; YYYY-MM-DD_HH-MM-SS style stamp via NSIS time
    ${GetTime} "" "L" $1 $2 $3 $4 $5 $6 $7
    ; $3=year $2=month $1=day $5=hour $6=min $7=sec
    StrCpy $8 "$APPDATA\Shop POS\data\backups\ShopPOS_Backup_$3-$2-$1_$5-$6-$7.db"
    CopyFiles /SILENT "$0" "$8"
  shoppos_skip_backup:
!macroend

; Never wipe AppData on uninstall unless the user explicitly chooses to remove data
; (electron-builder deleteAppDataOnUninstall is false).
