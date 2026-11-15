; ============================================================
;  ServicePulse — Windows installer (Metro UI)
;  Compile:  makensis -DSTAGE_DIR=<staged app dir> installer.nsi
;  Design: Windows 8 "Metro" language — flat Metro blue banner,
;  white surfaces, Segoe UI typography, accent progress bar.
;  Per-user install (no admin rights required).
; ============================================================

Unicode true
SetCompressor /SOLID lzma
ShowInstDetails nevershow
ShowUninstDetails nevershow

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinMessages.nsh"

!define APPNAME     "ServicePulse"
!define APPVERSION  "1.0.0"
!define METRO_BLUE  0x00D37800   ; BGR of #0078D3 (Metro blue)
!define UNINSTKEY   "Software\Microsoft\Windows\CurrentVersion\Uninstall\ServicePulse"

Name "${APPNAME}"
OutFile "ServicePulse-Setup-${APPVERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\ServicePulse"
InstallDirRegKey HKCU "Software\ServicePulse" "InstallDir"
RequestExecutionLevel user
Caption "${APPNAME} Setup"
BrandingText " "

Icon "assets/app.ico"
UninstallIcon "assets/app.ico"

Var Dlg
Var TitleFont
Var HdrFont
Var BodyFont
Var SmallFont
Var RunCheckbox
Var DirRequest

; ---------------- pages ----------------
Page custom WelcomeCreate WelcomeLeave
Page custom DirCreate DirLeave
Page instfiles "" InstFilesShow
Page custom FinishCreate FinishLeave
UninstPage custom un.WelcomeCreate un.WelcomeLeave
UninstPage instfiles

; ---------------- init ----------------
Function .onInit
  System::Call 'gdi32::CreateFont(i 30, i 0, i 0, i 0, i 600, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, t "Segoe UI").r0'
  StrCpy $TitleFont $0
  System::Call 'gdi32::CreateFont(i 16, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, t "Segoe UI").r0'
  StrCpy $HdrFont $0
  System::Call 'gdi32::CreateFont(i 15, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, t "Segoe UI").r0'
  StrCpy $BodyFont $0
  System::Call 'gdi32::CreateFont(i 12, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, t "Segoe UI").r0'
  StrCpy $SmallFont $0

  InitPluginsDir
  File /oname=$PLUGINSDIR\banner-welcome.bmp "assets/banner-welcome.bmp"
  File /oname=$PLUGINSDIR\banner-dir.bmp "assets/banner-dir.bmp"
  File /oname=$PLUGINSDIR\banner-finish.bmp "assets/banner-finish.bmp"
  File /oname=$PLUGINSDIR\banner-un.bmp "assets/banner-un.bmp"
FunctionEnd

Function un.onInit
  System::Call 'gdi32::CreateFont(i 30, i 0, i 0, i 0, i 600, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, t "Segoe UI").r0'
  StrCpy $TitleFont $0
  System::Call 'gdi32::CreateFont(i 16, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, t "Segoe UI").r0'
  StrCpy $HdrFont $0
  System::Call 'gdi32::CreateFont(i 15, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, t "Segoe UI").r0'
  StrCpy $BodyFont $0
  System::Call 'gdi32::CreateFont(i 12, i 0, i 0, i 0, i 400, i 0, i 0, i 0, i 0, i 0, i 0, i 5, i 0, t "Segoe UI").r0'
  StrCpy $SmallFont $0
  InitPluginsDir
  File /oname=$PLUGINSDIR\banner-welcome.bmp "assets/banner-welcome.bmp"
  File /oname=$PLUGINSDIR\banner-dir.bmp "assets/banner-dir.bmp"
  File /oname=$PLUGINSDIR\banner-finish.bmp "assets/banner-finish.bmp"
  File /oname=$PLUGINSDIR\banner-un.bmp "assets/banner-un.bmp"
FunctionEnd

; helper: Metro banner + white page background
!macro MetroPageBegin BANNER
  nsDialogs::Create 1018
  Pop $Dlg
  SetCtlColors $Dlg 0x333333 0xFFFFFF
  ${NSD_CreateBitmap} 0 0 100% 46u ""
  Pop $0
  ${NSD_SetStretchedImage} $0 $PLUGINSDIR\${BANNER} $1
!macroend

!macro MetroButtons NEXTTEXT HIDEBACK
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:${NEXTTEXT}"
  SendMessage $0 ${WM_SETFONT} $BodyFont 0
  GetDlgItem $0 $HWNDPARENT 2
  SendMessage $0 ${WM_SETFONT} $BodyFont 0
  GetDlgItem $0 $HWNDPARENT 3
  SendMessage $0 ${WM_SETFONT} $BodyFont 0
  !if "${HIDEBACK}" == "1"
    ShowWindow $0 ${SW_HIDE}
  !endif
!macroend

; ---------------- welcome ----------------
Function WelcomeCreate
  !insertmacro MetroPageBegin banner-welcome.bmp

  ${NSD_CreateLabel} 12u 58u -24u 12u "Setup will install ${APPNAME} ${APPVERSION} on your PC."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $BodyFont 1
  SetCtlColors $0 0x1a1a1a 0xFFFFFF

  ${NSD_CreateLabel} 12u 74u -24u 42u "Real-time CPU, memory and running-service monitoring$\r$\nDark terminal theme with light/dark toggle$\r$\nOptional telemetry sync to your own backend$\r$\nWorks fully offline — no account, no tracking"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $BodyFont 1
  SetCtlColors $0 0x444444 0xFFFFFF

  ${NSD_CreateLabel} 12u 118u -24u 8u "MIT licensed open source · github.com/redbloodfoxchaoseco-sys/servicepulse"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SmallFont 1
  SetCtlColors $0 0x777777 0xFFFFFF

  !insertmacro MetroButtons "Install" "1"
  nsDialogs::Show
FunctionEnd

Function WelcomeLeave
FunctionEnd

; ---------------- install directory ----------------
Function DirCreate
  !insertmacro MetroPageBegin banner-dir.bmp

  ${NSD_CreateLabel} 12u 60u -24u 10u "${APPNAME} will be installed in the folder below."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $BodyFont 1
  SetCtlColors $0 0x1a1a1a 0xFFFFFF

  ${NSD_CreateDirRequest} 12u 78u 64% 12u "$INSTDIR"
  Pop $DirRequest
  SendMessage $DirRequest ${WM_SETFONT} $BodyFont 1
  SetCtlColors $DirRequest 0x1a1a1a 0xFFFFFF
  ${NSD_CreateBrowseButton} 212u 78u 12% 12u "Browse..."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $BodyFont 1
  ${NSD_OnClick} $0 DirBrowse

  ${NSD_CreateLabel} 12u 100u -24u 24u "Installing to your user profile keeps ${APPNAME} available only for you, and needs no administrator rights."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SmallFont 1
  SetCtlColors $0 0x777777 0xFFFFFF

  !insertmacro MetroButtons "Install" "0"
  nsDialogs::Show
FunctionEnd

Function DirBrowse
  ${NSD_GetText} $DirRequest $0
  nsDialogs::SelectFolderDialog "Choose install location" $0
  Pop $0
  ${If} $0 != "error"
    ${NSD_SetText} $DirRequest $0
  ${EndIf}
FunctionEnd

Function DirLeave
  ${NSD_GetText} $DirRequest $INSTDIR
  ${If} ${FileExists} "$INSTDIR\ServicePulse.exe"
    MessageBox MB_OK|MB_ICONEXCLAMATION "${APPNAME} is already installed in this folder. It will be updated."
  ${EndIf}
  CreateDirectory "$INSTDIR"
FunctionEnd

; ---------------- install progress ----------------
Function InstFilesShow
  FindWindow $0 "#32770" "" $HWNDPARENT
  SetCtlColors $0 0x333333 0xFFFFFF
  GetDlgItem $1 $0 1006
  SendMessage $1 ${PBM_SETBARCOLOR} 0 ${METRO_BLUE}
  SendMessage $1 ${PBM_SETBKCOLOR} 0 0xFFFFFF
  GetDlgItem $1 $0 1200
  ShowWindow $1 ${SW_HIDE}
  GetDlgItem $1 $HWNDPARENT 1
  SendMessage $1 ${WM_SETFONT} $BodyFont 0
  GetDlgItem $1 $HWNDPARENT 3
  ShowWindow $1 ${SW_HIDE}
FunctionEnd

; ---------------- finish ----------------
Function FinishCreate
  !insertmacro MetroPageBegin banner-finish.bmp

  ${NSD_CreateLabel} 12u 60u -24u 12u "${APPNAME} ${APPVERSION} was installed successfully."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $BodyFont 1
  SetCtlColors $0 0x1a1a1a 0xFFFFFF

  ${NSD_CreateLabel} 12u 78u -24u 24u "Start it from the Start menu, the desktop shortcut, or right now:"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $BodyFont 1
  SetCtlColors $0 0x444444 0xFFFFFF

  ${NSD_CreateCheckbox} 12u 104u 86% 10u "Run ${APPNAME} now"
  Pop $RunCheckbox
  SendMessage $RunCheckbox ${WM_SETFONT} $BodyFont 1
  SetCtlColors $RunCheckbox 0x1a1a1a 0xFFFFFF
  ${NSD_SetState} $RunCheckbox ${BST_CHECKED}

  !insertmacro MetroButtons "Finish" "1"
  nsDialogs::Show
FunctionEnd

Function FinishLeave
  ${NSD_GetState} $RunCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    Exec '"$INSTDIR\ServicePulse.exe"'
  ${EndIf}
FunctionEnd

; ---------------- install section ----------------
Section "Install"
  SetOutPath $INSTDIR
  File /r "${STAGE_DIR}/*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  SetShellVarContext current
  CreateDirectory "$SMPROGRAMS\ServicePulse"
  CreateShortCut "$SMPROGRAMS\ServicePulse\ServicePulse.lnk" '"$INSTDIR\ServicePulse.exe"' "" "$INSTDIR\app.ico" 0
  CreateShortCut "$SMPROGRAMS\ServicePulse\Uninstall ServicePulse.lnk" '"$INSTDIR\Uninstall.exe"' "" "$INSTDIR\app.ico" 0
  CreateShortCut "$DESKTOP\ServicePulse.lnk" '"$INSTDIR\ServicePulse.exe"' "" "$INSTDIR\app.ico" 0

  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" '"$INSTDIR\ServicePulse.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "ServicePulse"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" '"$INSTDIR"'
  WriteRegStr HKCU "${UNINSTKEY}" "URLInfoAbout" "https://github.com/redbloodfoxchaoseco-sys/servicepulse"
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegStr HKCU "Software\ServicePulse" "InstallDir" $INSTDIR

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"
SectionEnd

; ---------------- uninstaller ----------------
Function un.WelcomeCreate
  !insertmacro MetroPageBegin banner-un.bmp

  ${NSD_CreateLabel} 12u 60u -24u 12u "This will remove ${APPNAME} ${APPVERSION} from your PC."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $BodyFont 1
  SetCtlColors $0 0x1a1a1a 0xFFFFFF

  ${NSD_CreateLabel} 12u 78u -24u 24u "Telemetry already sent to your backend (if any) is not touched."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SmallFont 1
  SetCtlColors $0 0x777777 0xFFFFFF

  !insertmacro MetroButtons "Uninstall" "1"
  nsDialogs::Show
FunctionEnd

Function un.WelcomeLeave
FunctionEnd

Section "un.Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\ServicePulse.lnk"
  RMDir /r "$SMPROGRAMS\ServicePulse"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\ServicePulse"
SectionEnd
