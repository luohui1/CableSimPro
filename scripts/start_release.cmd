@echo off
setlocal
set PYTHONUTF8=1
if not exist "%~dp0runtime\python\python.exe" (
  echo CableSimPro: bundled Python is missing. Extract the complete release ZIP.
  exit /b 1
)
"%~dp0runtime\python\python.exe" -I -B "%~dp0scripts\install_release.py" --config "%~dp0release.toml" %*
if errorlevel 1 (
  echo CableSimPro startup failed. See the messages above.
  pause
  exit /b 1
)
