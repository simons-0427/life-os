@echo off
setlocal
where pythonw.exe >nul 2>nul
if errorlevel 1 goto console
start "" pythonw.exe -B "%~dp0live_os.py"
exit /b
:console
python.exe -B "%~dp0live_os.py"
if errorlevel 1 pause
