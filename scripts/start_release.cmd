@echo off
setlocal
set PYTHONUTF8=1
py -3.12 "%~dp0scripts\install_release.py" --config "%~dp0release.toml" %*
if errorlevel 1 (
  echo CableSimPro startup failed. See the messages above.
  pause
  exit /b 1
)
