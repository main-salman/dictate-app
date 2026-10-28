#!/bin/bash

# Dictate Web App Launcher
# Usage: ./run.sh

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"

cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"

# Self-heal executable bits in case git didn't preserve them on clone.
chmod +x "$PROJECT_DIR/run.command" "$PROJECT_DIR/run.sh" 2>/dev/null

# Install a double-clickable Dictate.app into ~/Applications on first run, so a
# fresh clone "just works". The path is resolved dynamically (no hardcoding),
# and the executable is always refreshed so moving the repo self-heals.
setup_macos_app() {
  [ "$(uname)" = "Darwin" ] || return 0
  local app="$HOME/Applications/Dictate.app"
  local macos="$app/Contents/MacOS"
  local resources="$app/Contents/Resources"
  local first=0
  [ -d "$app" ] || first=1
  mkdir -p "$macos" "$resources"

  cat > "$macos/Dictate" <<EOF
#!/bin/bash
open "$PROJECT_DIR/run.command"
EOF
  chmod +x "$macos/Dictate"

  # Install the app icon (shows in Dock / Finder / Launchpad).
  [ -f "$PROJECT_DIR/static/AppIcon.icns" ] && cp "$PROJECT_DIR/static/AppIcon.icns" "$resources/AppIcon.icns"

  # Always rewrite Info.plist so updates (e.g. icon) take effect.
  cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Dictate</string>
  <key>CFBundleDisplayName</key><string>Dictate</string>
  <key>CFBundleIdentifier</key><string>com.local.dictate</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Dictate</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
  [ -f "$app/Contents/PkgInfo" ] || printf 'APPL????' > "$app/Contents/PkgInfo"

  if [ "$first" = "1" ]; then
    echo "==> Installed Dictate.app to ~/Applications (pin it to your Dock)."
  fi
  # Refresh icon cache / Launch Services registration.
  touch "$app"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" >/dev/null 2>&1
}

setup_macos_app

# Check for Python
if ! command -v python3 &>/dev/null; then
  echo "Error: python3 not found. Please install Python 3."
  exit 1
fi

# Check for ffmpeg (auto-install via Homebrew if missing)
if ! command -v ffmpeg &>/dev/null && [ ! -f /opt/homebrew/bin/ffmpeg ]; then
  if command -v brew &>/dev/null; then
    echo "==> First-time setup: installing ffmpeg..."
    brew install ffmpeg
  else
    echo "Error: ffmpeg not found and Homebrew is unavailable."
    echo "       Install Homebrew (https://brew.sh), then re-run; or: brew install ffmpeg"
    exit 1
  fi
fi

# Check for whisper-cli (auto-install whisper-cpp via Homebrew if missing)
if ! command -v whisper-cli &>/dev/null && [ ! -f /opt/homebrew/opt/whisper-cpp/bin/whisper-cli ]; then
  if command -v brew &>/dev/null; then
    echo "==> First-time setup: installing whisper-cpp..."
    brew install whisper-cpp
  else
    echo "Error: whisper-cli not found and Homebrew is unavailable."
    echo "       Install Homebrew (https://brew.sh), then re-run; or: brew install whisper-cpp"
    exit 1
  fi
fi

# Check for whisper model (downloaded once, ~150 MB)
MODEL="$HOME/whisper-models/ggml-base.en.bin"
if [ ! -f "$MODEL" ]; then
  echo ""
  echo "==> First-time setup: downloading the speech model (~150 MB)."
  echo "    This happens only once and may take a few minutes. Please wait..."
  mkdir -p ~/whisper-models
  curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin -o "$MODEL"
  echo "    Speech model ready."
fi

# Ollama + Refine model (optional feature). Auto-install/pull where possible.
LLM_MODEL="${DICTATE_LLM_MODEL:-llama3.1:8b}"

if ! command -v ollama &>/dev/null; then
  if command -v brew &>/dev/null; then
    echo ""
    echo "==> First-time setup: installing Ollama (powers the Refine feature)..."
    brew install ollama || echo "    Could not install Ollama automatically; Refine will be disabled."
  else
    echo "Note: Ollama not found and Homebrew unavailable. Refine will be disabled."
    echo "      Install Ollama from https://ollama.com to enable it."
  fi
fi

if command -v ollama &>/dev/null; then
  # Make sure the Ollama server is reachable before pulling.
  if ! curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "Starting Ollama service..."
    ollama serve >/dev/null 2>&1 &
    for _ in $(seq 1 30); do
      curl -s http://localhost:11434/api/tags >/dev/null 2>&1 && break
      sleep 1
    done
  fi

  # Auto-download the LLM model on first run.
  if ! ollama list 2>/dev/null | grep -q "${LLM_MODEL%%:*}"; then
    echo ""
    echo "==> First-time setup: downloading the AI model '$LLM_MODEL' (several GB)."
    echo "    This happens only once and may take several minutes on first run."
    echo "    Please wait..."
    ollama pull "$LLM_MODEL" && echo "    AI model ready."
  fi
fi

# Activate virtual environment (create if needed)
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
  source venv/bin/activate
  pip install flask
else
  source venv/bin/activate
  if ! python3 -c "import flask" &>/dev/null; then
    pip install flask
  fi
fi

URL="http://localhost:8080"
BROWSER_PROFILE="$HOME/.dictate-app-browser"

# Detect a Chromium-based browser so we can open a clean, app-style window.
# Falls back to the default browser if none are installed.
detect_browser() {
  local candidates=(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  )
  for c in "${candidates[@]}"; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
}

BROWSER_BIN="$(detect_browser)"

# Terminate any lingering Chromium process for our dedicated profile and clear
# stale singleton locks so a new launch never delegates to a windowless zombie
# process (which would exit immediately and trigger the EXIT cleanup trap).
kill_profile_browser() {
  pkill -f -- "--user-data-dir=$BROWSER_PROFILE" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f -- "--user-data-dir=$BROWSER_PROFILE" >/dev/null 2>&1 || break
    sleep 0.1
  done
  pkill -9 -f -- "--user-data-dir=$BROWSER_PROFILE" >/dev/null 2>&1 || true
  rm -f "$BROWSER_PROFILE/SingletonLock" \
        "$BROWSER_PROFILE/SingletonSocket" \
        "$BROWSER_PROFILE/SingletonCookie" 2>/dev/null || true
}

# Prevent Chrome from showing a "Restore pages? Chrome didn't shut down
# correctly" bubble after being stopped by cleanup().
clean_browser_prefs() {
  local prefs="$BROWSER_PROFILE/Default/Preferences"
  if [ -f "$prefs" ]; then
    sed -i '' 's/"exit_type":"Crashed"/"exit_type":"Normal"/g' "$prefs" 2>/dev/null || true
  fi
}

open_app_window_bg() {
  # Focus an existing profile window if running, otherwise open a new one.
  if [ -n "$BROWSER_BIN" ]; then
    local bpid
    bpid="$(pgrep -f -- "--user-data-dir=$BROWSER_PROFILE" | head -n 1)"
    if [ -n "$bpid" ]; then
      osascript -e "tell application \"System Events\" to set frontmost of first process whose unix id is $bpid to true" >/dev/null 2>&1 && return 0
    fi
    clean_browser_prefs
    "$BROWSER_BIN" --app="$URL" --user-data-dir="$BROWSER_PROFILE" \
      --no-first-run --no-default-browser-check \
      --hide-crash-restore-bubble --disable-session-crashed-bubble >/dev/null 2>&1 &
  else
    open "$URL"
  fi
}

# If Dictate is already running with an active window, focus it and exit.
# If a stale server is holding :8080 with no open window, stop it and start clean.
if curl -sf "$URL" >/dev/null 2>&1; then
  HEALTH_JSON="$(curl -sf "$URL/health" 2>/dev/null || true)"
  if echo "$HEALTH_JSON" | grep -Eq '"clients": *[1-9]'; then
    echo "Dictate is already running — focusing the app window..."
    open_app_window_bg
    exit 0
  else
    lsof -ti tcp:8080 | xargs kill >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      lsof -ti tcp:8080 >/dev/null 2>&1 || break
      sleep 0.1
    done
    lsof -ti tcp:8080 | xargs kill -9 >/dev/null 2>&1 || true
  fi
fi

# Ensure no orphaned profile browser process is lingering before we launch.
kill_profile_browser
clean_browser_prefs

# Start the server (we own its lifecycle). Debug off => single process.
echo ""
echo "  Starting Dictate at $URL ..."
DICTATE_DEBUG=0 DICTATE_AUTO_SHUTDOWN=1 python3 app.py > /tmp/dictate.log 2>&1 &
SERVER_PID=$!

# Stop both the server and the dedicated browser instance when this script exits.
cleanup() {
  trap - EXIT INT TERM HUP
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  kill_profile_browser
}
trap cleanup EXIT INT TERM HUP

# Wait until the server is ready.
SERVER_READY=0
for _ in $(seq 1 40); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  if curl -sf "$URL/health" >/dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  sleep 0.25
done

if [ "$SERVER_READY" != "1" ]; then
  echo "  Error: Dictate server failed to start. Log output:"
  cat /tmp/dictate.log 2>/dev/null || true
  exit 1
fi

if [ -n "$BROWSER_BIN" ]; then
  echo "  Dictate is running. Close the app window to quit."
  "$BROWSER_BIN" --app="$URL" --user-data-dir="$BROWSER_PROFILE" \
    --no-first-run --no-default-browser-check \
    --hide-crash-restore-bubble --disable-session-crashed-bubble >/dev/null 2>&1 &
  BROWSER_PID=$!

  # Stay running as long as both the server (which stops via /lifecycle/close
  # when the app window is closed) and the dedicated browser process are alive.
  sleep 1
  while kill -0 "$SERVER_PID" 2>/dev/null; do
    if ! kill -0 "$BROWSER_PID" 2>/dev/null && \
       ! pgrep -f -- "--user-data-dir=$BROWSER_PROFILE" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
else
  echo "  Opened in your default browser. Close the window or press Ctrl+C here to quit."
  open "$URL"
  wait "$SERVER_PID" 2>/dev/null || true
fi
