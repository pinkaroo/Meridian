; ─── Meridian Installer ───────────────────────────────────────────────────────
Unicode True
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"

; ── Metadata ──────────────────────────────────────────────────────────────────
!define APP_NAME      "Meridian"
!define APP_VERSION   "1.0.0"
!define APP_EXE       "meridian.exe"
!define INSTALL_DIR   "$PROGRAMFILES64\Meridian"
!define REG_KEY       "Software\Microsoft\Windows\CurrentVersion\Uninstall\Meridian"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "MeridianSetup.exe"
InstallDir "${INSTALL_DIR}"
InstallDirRegKey HKLM "${REG_KEY}" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
BrandingText " "

; ── Version info — REQUIRED to suppress Windows compatibility warning ──────────
VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName"      "${APP_NAME}"
VIAddVersionKey "ProductVersion"   "${APP_VERSION}"
VIAddVersionKey "FileDescription"  "${APP_NAME} Installer"
VIAddVersionKey "FileVersion"      "${APP_VERSION}"
VIAddVersionKey "CompanyName"      "Meridian"
VIAddVersionKey "LegalCopyright"   "Meridian"

; ── MUI Settings ──────────────────────────────────────────────────────────────
!define MUI_ABORTWARNING
!define MUI_ICON "..\src-tauri\icons\icon.ico"
!define MUI_UNICON "..\src-tauri\icons\icon.ico"

; Clean header — no bitmap, just text
!define MUI_HEADERIMAGE_RIGHT

; Welcome/Finish page — no sidebar bitmap (cleaner look)
!define MUI_WELCOMEPAGE_TITLE "Install Meridian ${APP_VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Meridian is a powerful AI agent desktop app.$\r$\n$\r$\nThis installer will:$\r$\n  • Install the Visual C++ Runtime (if needed)$\r$\n  • Install Meridian to $PROGRAMFILES64\Meridian$\r$\n  • Create Start Menu and Desktop shortcuts$\r$\n$\r$\nClick Install to continue."

!define MUI_FINISHPAGE_TITLE "Meridian is ready"
!define MUI_FINISHPAGE_TEXT "Meridian has been installed successfully."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Meridian"
!define MUI_FINISHPAGE_LINK "github.com/pinkaroo/Meridian"
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/pinkaroo/Meridian"

; Skip directory page for cleaner experience — install to standard location
; Comment out the next line if you want users to pick the directory
; !define MUI_PAGE_DIRECTORY

; Pages — minimal: welcome, progress, finish
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Uninstall pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ── Silent-mode auto-relaunch ─────────────────────────────────────────────────
; When the installer is run with /S (silent), the MUI finish page is skipped,
; so the "Launch Meridian" checkbox never fires.  We hook .onInstSuccess to
; relaunch the app ourselves after a silent update.
Function .onInstSuccess
  ; Only auto-relaunch in silent mode — interactive mode uses the finish page.
  IfSilent 0 done
    Exec '"$INSTDIR\${APP_EXE}"'
  done:
FunctionEnd

; ── Main install section ──────────────────────────────────────────────────────
Section "Meridian" SecMain
  SectionIn RO

  ; Kill any running instance before replacing the binary so Windows
  ; doesn't refuse to overwrite the locked exe.
  ; /F = force, /IM = by image name.  Ignore exit code — app may not be running.
  ExecWait 'taskkill /F /IM ${APP_EXE}' $0

  ; Short pause so the OS releases the file handle before we overwrite.
  Sleep 500

  SetOutPath "$INSTDIR"
  SetOverwrite on

  ; Install the app binary
  File "..\src-tauri\target\release\${APP_EXE}"

  ; Install Visual C++ Redistributable if needed
  DetailPrint "Checking Visual C++ Runtime..."
  ReadRegDword $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $0 != 1
    DetailPrint "Installing Visual C++ Runtime..."
    SetOutPath "$TEMP"
    File /nonfatal "prereqs\vc_redist.x64.exe"
    IfFileExists "$TEMP\vc_redist.x64.exe" 0 skip_vc
    ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart' $1
    skip_vc:
  ${Else}
    DetailPrint "Visual C++ Runtime already installed."
  ${EndIf}

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Add/Remove Programs entry
  WriteRegStr   HKLM "${REG_KEY}" "DisplayName"      "${APP_NAME}"
  WriteRegStr   HKLM "${REG_KEY}" "DisplayVersion"   "${APP_VERSION}"
  WriteRegStr   HKLM "${REG_KEY}" "Publisher"        "Meridian"
  WriteRegStr   HKLM "${REG_KEY}" "InstallLocation"  "$INSTDIR"
  WriteRegStr   HKLM "${REG_KEY}" "UninstallString"  '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKLM "${REG_KEY}" "NoModify"         1
  WriteRegDWORD HKLM "${REG_KEY}" "NoRepair"         1
  WriteRegStr   HKLM "${REG_KEY}" "DisplayIcon"      "$INSTDIR\${APP_EXE}"

  ; Start Menu shortcut
  CreateDirectory "$SMPROGRAMS\Meridian"
  CreateShortCut  "$SMPROGRAMS\Meridian\Meridian.lnk"   "$INSTDIR\${APP_EXE}"
  CreateShortCut  "$SMPROGRAMS\Meridian\Uninstall.lnk"  "$INSTDIR\Uninstall.exe"

  ; Desktop shortcut
  CreateShortCut "$DESKTOP\Meridian.lnk" "$INSTDIR\${APP_EXE}"

  DetailPrint "Done."
SectionEnd

; ── Uninstaller ───────────────────────────────────────────────────────────────
Section "Uninstall"
  ; Kill the app if running
  ExecWait 'taskkill /F /IM ${APP_EXE}' $0

  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir  "$INSTDIR"

  Delete "$SMPROGRAMS\Meridian\Meridian.lnk"
  Delete "$SMPROGRAMS\Meridian\Uninstall.lnk"
  RMDir  "$SMPROGRAMS\Meridian"
  Delete "$DESKTOP\Meridian.lnk"

  DeleteRegKey HKLM "${REG_KEY}"
SectionEnd
