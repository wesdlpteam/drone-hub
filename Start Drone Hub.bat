@echo off
setlocal
title CoDrone EDU Hub
cd /d "%~dp0drone_hub"

rem Find Python (py launcher first, then python on PATH)
set "PYEXE="
where py >nul 2>nul && set "PYEXE=py -3"
if not defined PYEXE (where python >nul 2>nul && set "PYEXE=python")
if not defined PYEXE goto :nopython

rem Practice Mode needs nothing extra. The real-drone library installs once
rem into a private environment - from the bundled "wheels" folder first
rem (no internet needed), online as a fallback. If both fail, Practice Mode
rem still works and we retry next start.
if not exist ".venv\Scripts\python.exe" %PYEXE% -m venv .venv
if not exist ".venv\Scripts\python.exe" goto :run

".venv\Scripts\python.exe" -c "import codrone_edu" >nul 2>nul
if not errorlevel 1 goto :run

echo Setting up the real-drone library...
if exist "wheels" ".venv\Scripts\python.exe" -m pip install --quiet --no-index --find-links wheels codrone-edu

".venv\Scripts\python.exe" -c "import codrone_edu" >nul 2>nul
if not errorlevel 1 goto :run

".venv\Scripts\python.exe" -m pip install --quiet --retries 1 --timeout 10 codrone-edu
".venv\Scripts\python.exe" -c "import codrone_edu" >nul 2>nul
if errorlevel 1 echo Could not install the drone library - Practice Mode still works.

:run
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" server.py %*
) else (
    %PYEXE% server.py %*
)
pause
goto :eof

:nopython
echo.
echo Python is not installed on this laptop.
echo 1. Go to https://www.python.org/downloads/
echo 2. Install it and TICK the box "Add Python to PATH"
echo 3. Double-click this file again
echo.
pause
