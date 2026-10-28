import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# Ensure Homebrew paths are searchable even when launched from Finder/Dock.
for _brew_dir in ("/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"):
    if os.path.isdir(_brew_dir) and _brew_dir not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = _brew_dir + os.pathsep + os.environ.get("PATH", "")

WHISPER_MODEL = os.path.expanduser("~/whisper-models/ggml-base.en.bin")
WHISPER_CLI = "/opt/homebrew/opt/whisper-cpp/bin/whisper-cli"
FFMPEG = "/opt/homebrew/bin/ffmpeg"

# Local LLM (Ollama) configuration. Stays fully offline — Ollama runs on
# localhost and works the same on macOS and Windows. Override with env vars.
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
LLM_MODEL = os.environ.get("DICTATE_LLM_MODEL", "llama3.1:8b")

LLM_SYSTEM_PROMPT = (
    "You are a writing assistant that refines dictated speech-to-text "
    "transcripts. The dictation may contain filler words, false starts, "
    "run-on sentences, grammar mistakes, and misrecognized words. Improve "
    "the text according to the requested mode while preserving the speaker's "
    "meaning, intent, and key details. Never invent facts. Output ONLY the "
    "resulting text with no preamble, commentary, or surrounding quotation marks."
)

REFINE_MODES = {
    "cleanup": (
        "Mode: Clean up. Fix grammar, spelling, and punctuation. Remove filler "
        "words (um, uh, like, you know) and false starts. Format any spoken "
        "quotes correctly. Keep it as natural prose in the speaker's voice. Do "
        "not summarize or drop content."
    ),
    "bullets": (
        "Mode: Bullet points. Reorganize the content into clear, concise bullet "
        "points grouped logically, fixing grammar along the way. Start each "
        "bullet with '- '. Use short sub-points only when helpful."
    ),
    "summarize": (
        "Mode: Summarize. Write a concise summary capturing the key points. Use "
        "a short paragraph, or bullet points (each starting with '- ') when "
        "there are several distinct points."
    ),
    "email": (
        "Mode: Email / Formal. Rewrite as a clear, polished, professional "
        "message. Fix grammar and structure it into readable paragraphs with a "
        "courteous, appropriate tone."
    ),
}

# Fallback: try PATH
if not os.path.exists(FFMPEG):
    FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
if not os.path.exists(WHISPER_CLI):
    WHISPER_CLI = shutil.which("whisper-cli") or WHISPER_CLI

# Window lifecycle tracking (used by run.sh so closing the app window on macOS
# reliably stops the server even when Chrome keeps a windowless process alive).
_lifecycle_lock = threading.Lock()
_active_clients = {}
_lifecycle_seq = 0
_active_jobs = 0


def copy_to_system_clipboard(text):
    """Copy text directly to the OS clipboard so clipboard copy succeeds even
    when the browser window is unfocused or backgrounded during app switching."""
    if not text:
        return False
    try:
        if sys.platform == "darwin":
            pbcopy = "/usr/bin/pbcopy" if os.path.exists("/usr/bin/pbcopy") else (shutil.which("pbcopy") or "pbcopy")
            env = {**os.environ, "LANG": "en_US.UTF-8", "LC_CTYPE": "UTF-8"}
            res = subprocess.run(
                [pbcopy],
                input=text.encode("utf-8"),
                env=env,
                capture_output=True,
                timeout=5,
            )
            return res.returncode == 0
        if sys.platform == "win32":
            res = subprocess.run(
                ["clip"],
                input=text.encode("utf-16le"),
                capture_output=True,
                timeout=5,
            )
            return res.returncode == 0
    except Exception as e:
        app.logger.warning(f"System clipboard copy failed: {e}")
    return False


def _schedule_shutdown_check(expected_seq):
    """Shut down the server if no windows remain open after a short grace
    period (which allows page refreshes to reconnect without stopping)."""
    if os.environ.get("DICTATE_AUTO_SHUTDOWN", "0") != "1":
        return

    def _check():
        time.sleep(1.5)
        with _lifecycle_lock:
            if _active_clients or _lifecycle_seq != expected_seq or _active_jobs > 0:
                return
        app.logger.info("All Dictate windows closed — stopping server.")
        try:
            os.kill(os.getpid(), signal.SIGTERM)
        except OSError:
            os._exit(0)

    t = threading.Thread(target=_check, daemon=True)
    t.start()


@app.route("/")
def index():
    global _lifecycle_seq
    with _lifecycle_lock:
        _lifecycle_seq += 1
    return render_template("index.html")


@app.route("/health")
def health():
    with _lifecycle_lock:
        clients = len(_active_clients)
    return jsonify({"status": "ok", "clients": clients})


@app.route("/lifecycle/open", methods=["POST"])
def lifecycle_open():
    global _lifecycle_seq
    data = request.get_json(silent=True) or {}
    client_id = data.get("clientId") or "default"
    with _lifecycle_lock:
        _active_clients[client_id] = time.time()
        _lifecycle_seq += 1
    return jsonify({"ok": True})


@app.route("/lifecycle/heartbeat", methods=["POST"])
def lifecycle_heartbeat():
    global _lifecycle_seq
    data = request.get_json(silent=True) or {}
    client_id = data.get("clientId") or "default"
    with _lifecycle_lock:
        _active_clients[client_id] = time.time()
        _lifecycle_seq += 1
    return jsonify({"ok": True})


@app.route("/lifecycle/close", methods=["POST"])
def lifecycle_close():
    global _lifecycle_seq
    data = request.get_json(silent=True)
    if not data:
        try:
            raw = request.get_data(as_text=True)
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {}
    client_id = (data or {}).get("clientId")
    with _lifecycle_lock:
        if client_id:
            _active_clients.pop(client_id, None)
        else:
            _active_clients.clear()
        _lifecycle_seq += 1
        seq = _lifecycle_seq
        empty = len(_active_clients) == 0
    if empty:
        _schedule_shutdown_check(seq)
    return jsonify({"ok": True})


@app.route("/copy", methods=["POST"])
def copy_endpoint():
    data = request.get_json(silent=True) or {}
    text = data.get("text") or ""
    if not text:
        return jsonify({"copied": False}), 400
    copied = copy_to_system_clipboard(text)
    return jsonify({"copied": copied})


@app.route("/transcribe", methods=["POST"])
def transcribe():
    global _active_jobs
    if "audio" not in request.files:
        return jsonify({"error": "No audio file provided"}), 400

    audio_file = request.files["audio"]
    work_dir = tempfile.mkdtemp()
    ext = request.form.get("ext", "webm")
    # sanitize extension to simple alnum to avoid surprises
    ext = "".join(c for c in ext.lower() if c.isalnum()) or "webm"
    raw_path = os.path.join(work_dir, f"recording_{uuid.uuid4().hex}.{ext}")
    wav_path = os.path.join(work_dir, "audio.wav")

    with _lifecycle_lock:
        _active_jobs += 1

    try:
        # Save uploaded audio
        audio_file.save(raw_path)

        file_size = os.path.getsize(raw_path)
        if file_size < 1024:
            # Too small to contain real audio (truncated/empty recording).
            return jsonify({
                "error": "No audio captured. Hold the button, speak, then "
                         "tap to stop — and check microphone access."
            }), 200

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
            app.logger.warning(f"ffmpeg failed: {error_msg[:800]}")
            # A truncated/empty webm shows up as EBML/EOF errors — give the user
            # an actionable message instead of a raw ffmpeg dump.
            lowered = error_msg.lower()
            if "ebml" in lowered or "end of file" in lowered or "invalid data" in lowered:
                return jsonify({
                    "error": "Recording was empty or got cut off. Hold the "
                             "button, speak, then tap to stop — and try again."
                }), 200
            return jsonify({"error": f"Audio conversion failed: {error_msg[:300]}"}), 500

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
        text = result.stdout
        text = re.sub(r'\[.*?\]', '', text)
        text = ' '.join(text.split()).strip()

        # Filter out non-speech markers when the entire output is e.g. "(blank audio)"
        if re.fullmatch(
            r'[\(\*\[\s]*(blank[\s_]*audio|silence|inaudible|no[\s_]*speech|music|sighs?|clicking|applause)[\)\*\]\s\.,!]*',
            text,
            flags=re.IGNORECASE,
        ):
            text = ""

        if not text:
            return jsonify({"error": "No speech detected"}), 200

        copied = copy_to_system_clipboard(text)
        return jsonify({"text": text, "copied": copied})

    except subprocess.TimeoutExpired:
        return jsonify({"error": "Processing timed out"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        with _lifecycle_lock:
            _active_jobs = max(0, _active_jobs - 1)
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


def _ollama_models():
    """Return installed model names, or None if Ollama is unreachable."""
    try:
        with urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=5) as resp:
            data = json.loads(resp.read().decode())
        return [m["name"] for m in data.get("models", [])]
    except Exception:
        return None


def _pick_model():
    """Choose a model to use. Returns (model_name, problem)."""
    models = _ollama_models()
    if models is None:
        return None, "unreachable"
    if not models:
        return None, "no_models"
    if LLM_MODEL in models:
        return LLM_MODEL, None
    # Fall back to any installed variant of the configured family, else first.
    base = LLM_MODEL.split(":")[0]
    for name in models:
        if name.split(":")[0] == base:
            return name, None
    return models[0], None


@app.route("/refine", methods=["POST"])
def refine():
    global _active_jobs
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    mode = data.get("mode", "cleanup")

    if not text:
        return jsonify({"error": "No text to refine"}), 400
    if mode not in REFINE_MODES:
        mode = "cleanup"

    model, problem = _pick_model()
    if problem == "unreachable":
        return jsonify({
            "error": "Local LLM not reachable. Install Ollama from "
                     "https://ollama.com and ensure it is running."
        }), 503
    if problem == "no_models":
        return jsonify({
            "error": f"No local model installed. Run: ollama pull {LLM_MODEL}"
        }), 503

    payload = {
        "model": model,
        "stream": False,
        "options": {"temperature": 0.3},
        "messages": [
            {"role": "system", "content": LLM_SYSTEM_PROMPT},
            {"role": "user",
             "content": f"{REFINE_MODES[mode]}\n\nTranscript:\n{text}"},
        ],
    }

    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with _lifecycle_lock:
        _active_jobs += 1

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            result = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="ignore")[:300]
        return jsonify({"error": f"Refine failed ({e.code}): {detail}"}), 502
    except urllib.error.URLError as e:
        return jsonify({"error": f"Refine failed: {e.reason}"}), 502
    except Exception as e:
        return jsonify({"error": f"Refine failed: {e}"}), 500
    finally:
        with _lifecycle_lock:
            _active_jobs = max(0, _active_jobs - 1)

    refined = (result.get("message", {}).get("content") or "").strip()
    if not refined:
        return jsonify({"error": "Model returned an empty response"}), 502

    copied = copy_to_system_clipboard(refined)
    return jsonify({"refined": refined, "model": model, "mode": mode, "copied": copied})


if __name__ == "__main__":
    # Env-configurable so the launcher can run a single, cleanly-stoppable
    # process (debug off disables the reloader's extra child process).
    debug = os.environ.get("DICTATE_DEBUG", "1") == "1"
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=debug)
