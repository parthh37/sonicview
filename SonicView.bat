@echo off
rem SonicView launcher.
rem Opens sonicview.html in its own app window (Edge, else Chrome), else in the default browser.
rem Keep this file in the same folder as sonicview.html.
setlocal
set "PAGE=%~dp0sonicview.html"
if not exist "%PAGE%" goto nopage
set "URL=file:///%PAGE:\=/%"

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" goto edge

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" goto chrome

start "" "%PAGE%"
exit /b 0

:edge
start "" "%EDGE%" --app="%URL%"
exit /b 0

:chrome
start "" "%CHROME%" --app="%URL%"
exit /b 0

:nopage
echo SonicView: cannot find sonicview.html next to this launcher.
echo Put SonicView.bat in the same folder as sonicview.html.
pause
exit /b 1
