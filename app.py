import os
import subprocess
import tempfile
import uuid
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

WHISPER_MODEL = os.path.expanduser("~/whisper-models/ggml-base.en.bin")
WHISPER_CLI = "/opt/homebrew/opt/whisper-cpp/bin/whisper-cli"
FFMPEG = "/opt/homebrew/bin/ffmpeg"

# Fallback: try PATH
if not os.path.exists(FFMPEG):
    import shutil
    FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
if not os.path.exists(WHISPER_CLI):
    import shutil
    WHISPER_CLI = shutil.which("whisper-cli") or WHISPER_CLI


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    audio_file = request.files["audio"]
    work_dir = tempfile.mkdtemp()
    ext = request.form.get("ext", "webm")
    # sanitize extension to simple alnum to avoid surprises
    ext = "".join(c for c in ext.lower() if c.isalnum()) or "webm"
    raw_path = os.path.join(work_dir, f"recording_{uuid.uuid4().hex}.{ext}")
    wav_path = os.path.join(work_dir, "audio.wav")

    try:
        # Save uploaded audio
        audio_file.save(raw_path)

        file_size = os.path.getsize(raw_path)
        if file_size == 0:
            return jsonify({"error": "Empty audio file"}), 400

        # Quick sanity check: valid WebM starts with EBML magic bytes 1A 45 DF A3
        with open(raw_path, 'rb') as f:
            header = f.read(16)
        header_hex = header.hex(' ')
        app.logger.info(f"Audio file: {file_size} bytes, header: {header_hex}")

        # Convert to 16kHz WAV (whisper requirement)
        result = subprocess.run(
            [
                # Trim banner so real errors surface in API response
                FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin",
                "-i", raw_path,
                "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
                wav_path, "-y"
            ],
            capture_output=True, text=True, timeout=30
        )

        if result.returncode != 0:
            error_msg = result.stderr.strip() or "Unknown ffmpeg error"
            return jsonify({"error": f"Audio conversion failed: {error_msg[:800]}"}), 500

        if not os.path.exists(wav_path) or os.path.getsize(wav_path) == 0:
            return jsonify({"error": "Audio conversion produced empty file"}), 500

        # Transcribe with whisper
        result = subprocess.run(
            [WHISPER_CLI, "-m", WHISPER_MODEL, "-f", wav_path, "-nt"],
            capture_output=True, text=True, timeout=120
        )

        if result.returncode != 0:
            return jsonify({"error": f"Transcription failed: {result.stderr[:200]}"}), 500

        # Clean up text — remove timestamps, trim whitespace
        import re
        text = result.stdout
        text = re.sub(r'\[.*?\]', '', text)
        text = ' '.join(text.split()).strip()

        if not text:
            return jsonify({"error": "No speech detected"}), 200

        return jsonify({"text": text})

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Processing timed out"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        # Clean up temp files
        for f in [raw_path, wav_path]:
            try:
                os.remove(f)
            except OSError:
                pass
        try:
            os.rmdir(work_dir)
        except OSError:
            pass


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=True)
