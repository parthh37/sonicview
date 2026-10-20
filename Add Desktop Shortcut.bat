@echo off
rem Puts a "SonicView" shortcut on your desktop. It starts SonicView.bat in this folder.
rem Run it again if you move this folder.
setlocal
set "SV_DIR=%~dp0"
set "SV_ICON=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%SV_ICON%" set "SV_ICON=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%SV_DIR%SonicView.bat" goto missing
powershell -NoProfile -Command "$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'SonicView.lnk')); $s.TargetPath=$env:SV_DIR+'SonicView.bat'; $s.WorkingDirectory=$env:SV_DIR; $s.WindowStyle=7; $s.Description='SonicView firewall visualizer'; if(Test-Path $env:SV_ICON){$s.IconLocation=$env:SV_ICON+',0'}; $s.Save(); Write-Host ('Shortcut made: '+(Join-Path $d 'SonicView.lnk'))"
if errorlevel 1 goto failed
pause
exit /b 0

:missing
echo Cannot find SonicView.bat next to this file.
pause
exit /b 1

:failed
echo The shortcut could not be made.
pause
exit /b 1
