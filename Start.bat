@echo off
rem FPV KAMIKAZE — spustí hru jako samostatnou aplikaci (bez adresního řádku)
setlocal
set "GAME=%~dp0index.html"
set "GAME=%GAME:\=/%"
set "URL=file:///%GAME%"

set "CH1=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CH2=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
set "CH3=%LocalAppData%\Google\Chrome\Application\chrome.exe"
set "EG1=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "EG2=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

if exist "%CH1%" ( start "" "%CH1%" --app="%URL%" --start-maximized & exit /b )
if exist "%CH2%" ( start "" "%CH2%" --app="%URL%" --start-maximized & exit /b )
if exist "%CH3%" ( start "" "%CH3%" --app="%URL%" --start-maximized & exit /b )
if exist "%EG1%" ( start "" "%EG1%" --app="%URL%" --start-maximized & exit /b )
if exist "%EG2%" ( start "" "%EG2%" --app="%URL%" --start-maximized & exit /b )

rem fallback: výchozí prohlížeč
start "" "%GAME%"
