@echo off
setlocal enabledelayedexpansion

rem Dictate Web App launcher for Windows (double-clickable).
rem Mirrors run.sh. Requires ffmpeg and whisper-cli on PATH.

cd /d "%~dp0"

rem Install a Start Menu shortcut on first run so a fresh clone "just works".
rem Path is resolved dynamically from this script's location (no hardcoding).
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Dictate.lnk"
if not exist "%LNK%" (
  powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LNK%'); $s.TargetPath='%~f0'; $s.WorkingDirectory='%~dp0'; $s.Description='Dictate'; $s.Save()" >nul 2>&1
  echo ==^> Installed a 'Dictate' shortcut to the Start Menu ^(pin it to taskbar^).
)

where python >nul 2>&1
if errorlevel 1 (
  echo Error: python not found. Please install Python 3 from https://python.org and add it to PATH.
  pause
  exit /b 1
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
  where winget >nul 2>&1
  if errorlevel 1 (
    echo Error: ffmpeg not found and winget unavailable.
    echo        Install ffmpeg and add it to PATH, then re-run.
    pause
    exit /b 1
  ) else (
    echo ==^> First-time setup: installing ffmpeg...
    winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
    echo     If ffmpeg is still not found, re-run run.bat so PATH picks it up.
  )
)

where whisper-cli >nul 2>&1
if errorlevel 1 (
  echo Error: whisper-cli not found. Install whisper.cpp and add whisper-cli to PATH.
  echo        See https://github.com/ggerganov/whisper.cpp for Windows builds.
  pause
  exit /b 1
)

set "MODEL=%USERPROFILE%\whisper-models\ggml-base.en.bin"
if not exist "%MODEL%" (
  echo.
  echo ==^> First-time setup: downloading the speech model ^(~150 MB^).
  echo     This happens only once and may take a few minutes. Please wait...
  if not exist "%USERPROFILE%\whisper-models" mkdir "%USERPROFILE%\whisper-models"
  curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin -o "%MODEL%"
  echo     Speech model ready.
)

rem Ollama + Refine model (optional feature). Auto-install/pull where possible.
if "%DICTATE_LLM_MODEL%"=="" set "DICTATE_LLM_MODEL=llama3.1:8b"

where ollama >nul 2>&1
if errorlevel 1 (
  where winget >nul 2>&1
  if errorlevel 1 (
    echo Note: Ollama not found and winget unavailable. Refine will be disabled.
    echo       Install Ollama from https://ollama.com to enable it.
  ) else (
    echo.
    echo ==^> First-time setup: installing Ollama ^(powers the Refine feature^)...
    winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
    echo     If this is the first install, you may need to re-run run.bat so Ollama is on PATH.
  )
)

where ollama >nul 2>&1
if not errorlevel 1 (
  rem Make sure the Ollama server is reachable before pulling.
  curl -s http://localhost:11434/api/tags >nul 2>&1
  if errorlevel 1 (
    echo Starting Ollama service...
    start "" /b ollama serve >nul 2>&1
    set "OLLAMA_UP="
    for /l %%i in (1,1,30) do (
      if not defined OLLAMA_UP (
        curl -s http://localhost:11434/api/tags >nul 2>&1 && set "OLLAMA_UP=1"
        if not defined OLLAMA_UP timeout /t 1 >nul
      )
    )
  )

  rem Auto-download the LLM model on first run.
  ollama list 2>nul | findstr /i "%DICTATE_LLM_MODEL:~0,8%" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo ==^> First-time setup: downloading the AI model '%DICTATE_LLM_MODEL%' ^(several GB^).
    echo     This happens only once and may take several minutes on first run.
    echo     Please wait...
    ollama pull %DICTATE_LLM_MODEL%
    echo     AI model ready.
  )
)

if not exist "venv" (
  echo Creating virtual environment...
  python -m venv venv
  call venv\Scripts\activate.bat
  pip install flask
) else (
  call venv\Scripts\activate.bat
)

set "URL=http://localhost:8080"
set "BROWSER_PROFILE=%USERPROFILE%\.dictate-app-browser"

rem Detect a Chromium-based browser for a clean, app-style window.
set "BROWSER_BIN="
for %%B in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
) do if not defined BROWSER_BIN if exist "%%~B" set "BROWSER_BIN=%%~B"

rem If Dictate is already running, just open/focus the app window and exit.
curl -s %URL% >nul 2>&1
if not errorlevel 1 (
  echo Dictate is already running - opening the app window...
  if defined BROWSER_BIN (
    start "" "!BROWSER_BIN!" --app=%URL% --user-data-dir="%BROWSER_PROFILE%" --no-first-run --no-default-browser-check
  ) else (
    start "" %URL%
  )
  exit /b 0
)

rem Start the server. Debug off => single process.
echo.
echo   Starting Dictate at %URL% ...
set "DICTATE_DEBUG=0"
start "DictateServer" /min cmd /c "python app.py"

rem Wait until the server is ready.
set "APP_UP="
for /l %%i in (1,1,40) do (
  if not defined APP_UP (
    curl -s %URL% >nul 2>&1 && set "APP_UP=1"
    if not defined APP_UP timeout /t 1 >nul
  )
)

if defined BROWSER_BIN (
  echo   Dictate is running. Close the app window to quit.
  rem Blocks until the app window (dedicated profile) is closed.
  start "" /wait "!BROWSER_BIN!" --app=%URL% --user-data-dir="%BROWSER_PROFILE%" --no-first-run --no-default-browser-check
) else (
  echo   Opened in your default browser. Close this window to quit.
  start "" %URL%
)

rem Stop the server we started (everything listening on port 8080).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1
