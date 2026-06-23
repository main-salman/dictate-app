# Dictate App

A private, offline dictation application for macOS, designed for secure environments where cloud-based dictation services are restricted.

## Overview

Dictate is a local web application that provides high-quality speech-to-text functionality without requiring an internet connection. It leverages OpenAI's Whisper model (via `whisper.cpp`) running locally on your machine to ensure data privacy and security.

This app was created to overcome limitations on work computers that block cloud-based dictation tools like SuperWhisper, Whisprflow and others, providing a superior alternative to the built-in macOS dictation.

<img width="1498" height="1632" alt="image" src="https://github.com/user-attachments/assets/839bcf57-df12-41ed-8912-abb1dc514359" />


## Features

- **Offline Privacy**: No audio data leaves your computer.
- **High Accuracy**: Uses the robust Whisper model for accurate transcription.
- **AI Refine (local)**: One click to clean up grammar and quotes, turn rambling thoughts into bullet points, summarize, or rewrite as a formal message — all via a local LLM (Ollama), so nothing leaves your machine.
- **Original / Refined toggle**: Switch between the raw transcription and the refined version; both are saved to history and are copyable.
- **System Integration**: Can be installed as a Chrome app and integrated into the macOS Dock.
- **Simple Interface**: One-click recording and transcription.

## Prerequisites

- **macOS** (Apple Silicon recommended for best performance)
- **Python 3**
- **Homebrew** (for installing dependencies)

## Components Used

The application relies on the following components, which are checked/installed by the startup script:

1.  **Flask**: A lightweight Python web framework to serve the application interface.
2.  **ffmpeg**: A powerful multimedia framework used to convert recorded audio to the format required by Whisper (16kHz WAV).
3.  **whisper.cpp**: A port of OpenAI's Whisper model in C/C++, allowing for high-performance inference on the CPU/GPU.
    *   **whisper-cli**: The command-line tool for running the model.
4.  **Whisper Model**: The `ggml-base.en.bin` model file, which is downloaded automatically if missing.
5.  **Ollama** (optional, for the Refine feature): A cross-platform (macOS/Windows/Linux) local LLM runtime. Refine calls it over `http://localhost:11434`, fully offline.

## Refine (Local AI) Setup

The **Refine** button next to Copy uses a local LLM via [Ollama](https://ollama.com) to fix grammar/quotes, structure thoughts into bullet points, summarize, or rewrite formally. It is optional — transcription works without it.

**This is handled automatically.** On first run, the launcher installs Ollama (Homebrew on macOS / winget on Windows), starts it, and downloads the default model (`llama3.1:8b`, several GB) — printing progress so you know to wait. This only happens once.

If you prefer to set it up manually, or auto-install isn't available on your system:

1.  Install Ollama for your OS from [ollama.com](https://ollama.com) (works on macOS and Windows).
2.  Pull a model (a recent ~8B model is a good balance of quality and speed):
    ```bash
    ollama pull llama3.1:8b
    ```
3.  Make sure Ollama is running (it runs as a background service after install).

Configuration via environment variables (optional):

-   `DICTATE_LLM_MODEL` — model name to use (default `llama3.1:8b`). If the exact model isn't installed, the app falls back to another installed variant of the same family, or the first installed model.
-   `OLLAMA_HOST` — Ollama base URL (default `http://localhost:11434`).

## Installation

1.  **Clone/Download** this repository to your local machine.
2.  **Install Dependencies**:
    The `run.sh` script will attempt to install necessary dependencies using Homebrew. Ensure you have Homebrew installed.
    ```bash
    brew install ffmpeg whisper-cpp
    ```
3.  **Run the Application**:

    **macOS** — double-click `run.command` in Finder, or from a terminal:
    ```bash
    ./run.sh
    ```

    **Windows** — double-click `run.bat`, or from a terminal:
    ```bat
    run.bat
    ```
    (On Windows, make sure `ffmpeg` and `whisper-cli` are installed and on your `PATH`.)

    The launcher will (on first run):
    *   Create a double-clickable app shortcut (`~/Applications/Dictate.app` on macOS / a Start Menu shortcut on Windows).
    *   Check for Python.
    *   Install ffmpeg and whisper-cli if missing (Homebrew on macOS / winget on Windows for ffmpeg; see notes for whisper.cpp on Windows).
    *   Download the Whisper speech model if it's missing (~150 MB, one time).
    *   Install Ollama and download the Refine AI model if missing (several GB, one time) — via Homebrew on macOS or winget on Windows.
    *   Set up a Python virtual environment and install Flask.
    *   Launch the web server at `http://localhost:8080`.

    > **First run takes longer.** The speech model (~150 MB) and the AI model (several GB) are downloaded only once. The launcher prints clear progress messages while you wait; subsequent runs start instantly.

## Standalone App Window

The launcher now opens Dictate as a clean, chromeless **app window** automatically — no manual browser-shortcut steps needed.

- On launch, `run.command` / `run.sh` (macOS) and `run.bat` (Windows) start the server **and** open the app window.
- The window uses the first available Chromium-based browser in `--app` mode (Chrome → Brave → Edge), falling back to your default browser. It runs in a dedicated, isolated profile (`~/.dictate-app-browser`) so it behaves like a separate app.
- **Closing the app window stops the server.** If Dictate is already running, launching again just opens/focuses the window (it won't start a second server).

### macOS: Dictate.app (Dock-pinnable)

The **first time** you run the app (via `./run.sh` or by double-clicking `run.command`), a double-clickable **`Dictate.app`** is created automatically in `~/Applications`, pointing at wherever you cloned the repo. Double-click it to open a Terminal (showing status) and the app window together. To keep it handy, right-click its Dock icon and choose **Options > Keep in Dock**.

> The shortcut's path is resolved dynamically, so cloning anywhere works. If you move the repo, just run `./run.sh` once and the shortcut self-updates.

**App icon:** the app now ships a branded mic icon (`static/icon.svg` + generated PNGs/`AppIcon.icns`). `Dictate.app` uses it in the Dock/Finder. Because a CLI `--app` window runs under Google Chrome, that specific window's Dock icon is Chrome's; for a fully branded standalone window, open the app and use Chrome's **⋮ > Cast, Save and Share > Install Dictate** — it now uses the mic icon (instead of the generic "D") via the web manifest.

### Windows

The first time you run `run.bat`, a **Dictate** shortcut is created in your Start Menu (pin it to the taskbar if you like). It opens an Edge/Chrome `--app` window the same way.

## Usage

1.  Launch the app (via the Dock shortcut or `run.sh`).
2.  Click the microphone icon to start recording.
3.  Speak your text.
4.  Click the stop button to finish recording.
5.   The text will be transcribed and appear on the screen.
6.  (Optional) Click **Refine** and choose a mode — *Clean up*, *Bullet points*, *Summarize*, or *Email / Formal* — to have the local LLM polish the text. Use the **Original / Refined** toggle to compare.
7.  Copy the text to your clipboard and paste it into your desired application.

## Troubleshooting

-   **"ffmpeg not found"**: Run `brew install ffmpeg`.
-   **"whisper-cli not found"**: Run `brew install whisper-cpp`.
-   **Permission Issues**: Ensure `run.sh` is executable: `chmod +x run.sh`.
-   **"Local LLM not reachable" when refining**: Install [Ollama](https://ollama.com) and make sure it is running.
-   **"No local model installed"**: Run `ollama pull llama3.1:8b` (or set `DICTATE_LLM_MODEL` to a model you have).
