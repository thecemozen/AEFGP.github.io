; K1 Max Dilimleyici - Windows kurulum programı (NSIS)
; Yönetici izni istemez: kullanıcının kendi klasörüne (%LOCALAPPDATA%\Programs) kurulur.
Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0"
!endif
!define APPNAME "K1 Max Dilimleyici"
!define EXE "K1MaxDilimleyici.exe"
!define PROGID "K1MaxDilimleyici.Model"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\K1MaxDilimleyici"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\K1MaxDilimleyici"
InstallDirRegKey HKCU "${UNINST}" "InstallLocation"
RequestExecutionLevel user
BrandingText "${APPNAME} ${VERSION}"
VIProductVersion "${VERSION}.0.0"
VIAddVersionKey /LANG=1055 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1055 "FileDescription" "${APPNAME} Kurulumu"
VIAddVersionKey /LANG=1055 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1055 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1055 "LegalCopyright" "AGPL-3.0"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "${APPNAME} programını başlat"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"

Section "Kur"
  ; açık program varsa kapat (güncellemede dosyalar kilitli kalmasın)
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Sleep 500
  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\resources"
  File /r "${SRCDIR}\*.*"
  WriteUninstaller "$INSTDIR\Kaldir.exe"

  CreateShortcut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0

  ; STL / 3MF: "Birlikte aç" listesine ekle (varsayılan programı değiştirmez)
  WriteRegStr HKCU "Software\Classes\${PROGID}" "" "3B model (${APPNAME})"
  WriteRegStr HKCU "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\.stl\OpenWithProgids" "${PROGID}" ""
  WriteRegStr HKCU "Software\Classes\.3mf\OpenWithProgids" "${PROGID}" ""
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}\shell\open\command" "" '"$INSTDIR\${EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}\SupportedTypes" ".stl" ""
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}\SupportedTypes" ".3mf" ""
  WriteRegStr HKCU "Software\Classes\Applications\${EXE}" "FriendlyAppName" "${APPNAME}"

  ; Programlar ve Özellikler'de görünsün
  WriteRegStr HKCU "${UNINST}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "thecemozen"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Kaldir.exe"'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Sleep 500
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  Delete "$DESKTOP\${APPNAME}.lnk"
  DeleteRegValue HKCU "Software\Classes\.stl\OpenWithProgids" "${PROGID}"
  DeleteRegValue HKCU "Software\Classes\.3mf\OpenWithProgids" "${PROGID}"
  DeleteRegKey HKCU "Software\Classes\${PROGID}"
  DeleteRegKey HKCU "Software\Classes\Applications\${EXE}"
  DeleteRegKey HKCU "${UNINST}"
  RMDir /r "$INSTDIR"
  ; Ayarlar ve profiller (%APPDATA%\K1 Max Dilimleyici) bilerek silinmez: yeniden kurulumda geri gelir
SectionEnd
