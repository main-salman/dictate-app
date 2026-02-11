# Dictate App

A private, offline dictation application for macOS, designed for secure environments where cloud-based dictation services are restricted.

## Overview

Dictate is a local web application that provides high-quality speech-to-text functionality without requiring an internet connection. It leverages OpenAI's Whisper model (via `whisper.cpp`) running locally on your machine to ensure data privacy and security.

This app was created to overcome limitations on work computers that block cloud-based dictation tools like SuperWhisper, Whisprflow and others, providing a superior alternative to the built-in macOS dictation.

<img width="1498" height="1632" alt="image" src="https://github.com/user-attachments/assets/839bcf57-df12-41ed-8912-abb1dc514359" />


## Features

- **Offline Privacy**: No audio data leaves your computer.
- **High Accuracy**: Uses the robust Whisper model for accurate transcription.
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

## Installation

1.  **Clone/Download** this repository to your local machine.
2.  **Install Dependencies**:
    The `run.sh` script will attempt to install necessary dependencies using Homebrew. Ensure you have Homebrew installed.
    ```bash
    brew install ffmpeg whisper-cpp
    ```
3.  **Run the Application**:
    Navigate to the project folder in your terminal and execute the run script:
    ```bash
    ./run.sh
    ```
    This script will:
    *   Check for Python, ffmpeg, and whisper-cli.
    *   Download the Whisper model if it's missing.
    *   Set up a Python virtual environment and install Flask.
    *   Launch the web server at `http://localhost:8080`.

## Setup as a Standalone App

To make Dictate feel like a native application and add it to your Dock:

1.  Start the application using `./run.sh`.
2.  Open Google Chrome and navigate to `http://localhost:8080`.
3.  Click the **three dots** menu in the top-right corner of Chrome.
4.  Select **Cast, Save and Share** > **Create Shortcut...**.
5.  Name the shortcut "Dictate" and ensure the **Open as window** checkbox is selected.
6.  Click **Create**.

The app will now open in its own window. You can right-click the icon in your Dock and select **Options > Keep in Dock** for easy access.

## Usage

1.  Launch the app (via the Dock shortcut or `run.sh`).
2.  Click the microphone icon to start recording.
3.  Speak your text.
4.  Click the stop button to finish recording.
5.   The text will be transcribed and appear on the screen.
6.  Copy the text to your clipboard and paste it into your desired application.

## Troubleshooting

-   **"ffmpeg not found"**: Run `brew install ffmpeg`.
-   **"whisper-cli not found"**: Run `brew install whisper-cpp`.
-   **Permission Issues**: Ensure `run.sh` is executable: `chmod +x run.sh`.
