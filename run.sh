#!/bin/bash

# Dictate Web App Launcher
# Usage: ./run.sh

cd "$(dirname "$0")"

# Check for Python
if ! command -v python3 &>/dev/null; then
  echo "Error: python3 not found. Please install Python 3."
  exit 1
fi

# Check for ffmpeg
if ! command -v ffmpeg &>/dev/null && [ ! -f /opt/homebrew/bin/ffmpeg ]; then
  echo "Error: ffmpeg not found. Install with: brew install ffmpeg"
  exit 1
fi

# Check for whisper-cli
WHISPER_CLI="/opt/homebrew/opt/whisper-cpp/bin/whisper-cli"
if [ ! -f "$WHISPER_CLI" ]; then
  echo "Error: whisper-cli not found. Install with: brew install whisper-cpp"
  exit 1
fi

# Check for whisper model
MODEL="$HOME/whisper-models/ggml-base.en.bin"
if [ ! -f "$MODEL" ]; then
  echo "Whisper model not found. Downloading..."
  mkdir -p ~/whisper-models
  curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin -o "$MODEL"
fi

# Activate virtual environment (create if needed)
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
  source venv/bin/activate
  pip install flask
else
  source venv/bin/activate
fi

echo ""
echo "  ┌──────────────────────────────────────┐"
echo "  │                                      │"
echo "  │   🎙️  Dictate is running              │"
echo "  │                                      │"
echo "  │   Open: http://localhost:8080        │"
echo "  │   Shortcut: Option + .               │"
echo "  │   Press Ctrl+C to stop               │"
echo "  │                                      │"
echo "  └──────────────────────────────────────┘"
echo ""

python3 app.py
