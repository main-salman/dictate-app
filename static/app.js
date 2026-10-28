// State
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let isStartingRecording = false;
let isProcessing = false;
let recordingStartTime = 0;
let history = [];
let chosenMimeType = 'audio/webm';
let chosenExt = 'webm';

// Refine state
let currentRaw = '';
let currentRefined = '';
let currentView = 'original';
let currentHistoryItem = null;
let isRefining = false;

// Clipboard & focus state
let copyTimeout = null;
let editSyncTimeout = null;
let pendingClipboardText = '';
let isPointerDown = false;
const clientId = (window.crypto && window.crypto.randomUUID)
  ? window.crypto.randomUUID()
  : `client_${Date.now()}_${Math.random().toString(36).slice(2)}`;

// DOM elements
const recordBtn = document.getElementById('recordBtn');
const micIcon = document.getElementById('micIcon');
const stopIcon = document.getElementById('stopIcon');
const pulseRing = document.getElementById('pulseRing');
const statusText = document.getElementById('statusText');
const waveform = document.getElementById('waveform');
const resultSection = document.getElementById('resultSection');
const resultText = document.getElementById('resultText');
const processingSection = document.getElementById('processingSection');
const historyCard = document.getElementById('historyCard');
const historyList = document.getElementById('historyList');
const copyBtn = document.getElementById('copyBtn');
const copyBtnText = document.getElementById('copyBtnText');
const refineBtn = document.getElementById('refineBtn');
const refineMenu = document.getElementById('refineMenu');
const viewToggle = document.getElementById('viewToggle');
const viewOriginalBtn = document.getElementById('viewOriginalBtn');
const viewRefinedBtn = document.getElementById('viewRefinedBtn');
const refineStatus = document.getElementById('refineStatus');
const refineStatusText = document.getElementById('refineStatusText');

// Toggle recording
async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else if (!isStartingRecording && !isProcessing) {
    await startRecording();
  }
}

// Start recording
async function startRecording() {
  if (isRecording || isStartingRecording || isProcessing) return;
  isStartingRecording = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Pick the best supported mime type and extension
    const preferredTypes = [
      { type: 'audio/webm;codecs=opus', ext: 'webm' },
      { type: 'audio/webm', ext: 'webm' },
      { type: 'audio/ogg;codecs=opus', ext: 'ogg' },
      { type: 'audio/mp4', ext: 'm4a' }
    ];

    const supported = preferredTypes.find(entry => MediaRecorder.isTypeSupported(entry.type));
    chosenMimeType = supported ? supported.type : 'audio/webm';
    chosenExt = supported ? supported.ext : 'webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType: chosenMimeType });

    audioChunks = [];
   
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
   
    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: chosenMimeType });
      stream.getTracks().forEach(track => track.stop());

      // Guard against empty/truncated recordings (e.g. a too-quick tap, or the
      // first recording in a fresh browser profile before the mic warms up).
      // These produce a tiny webm with no audio that ffmpeg can't decode.
      const tooShort = (Date.now() - recordingStartTime) < 400;
      if (audioChunks.length === 0 || audioBlob.size < 1200 || tooShort) {
        isProcessing = false;
        processingSection.classList.add('hidden');
        if (currentRaw) {
          resultSection.classList.remove('hidden');
        } else {
          resultSection.classList.add('hidden');
        }
        statusText.textContent = "Didn't catch that — hold the button, speak, then tap to stop.";
        return;
      }

      sendAudio(audioBlob);
    };
   
    mediaRecorder.start(); // Single blob on stop – avoids corrupt EBML header
    isRecording = true;
    recordingStartTime = Date.now();
   
    // Update UI
    recordBtn.classList.add('recording');
    micIcon.classList.add('hidden');
    stopIcon.classList.remove('hidden');
    pulseRing.classList.add('active');
    statusText.textContent = 'Recording... Tap to stop';
    statusText.classList.add('recording');
    waveform.classList.remove('hidden');
    processingSection.classList.add('hidden');
   
  } catch (err) {
    console.error('Microphone access denied:', err);
    statusText.textContent = 'Microphone access denied. Please allow access.';
  } finally {
    isStartingRecording = false;
  }
}

// Stop recording
function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  isProcessing = true;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
 
  // Update UI
  recordBtn.classList.remove('recording');
  micIcon.classList.remove('hidden');
  stopIcon.classList.add('hidden');
  pulseRing.classList.remove('active');
  statusText.textContent = 'Processing...';
  statusText.classList.remove('recording');
  waveform.classList.add('hidden');
  processingSection.classList.remove('hidden');
  resultSection.classList.add('hidden');
}

// Send audio to server
async function sendAudio(blob) {
  const formData = new FormData();
  formData.append('audio', blob, `recording.${chosenExt}`);
  formData.append('mimeType', chosenMimeType);
  formData.append('ext', chosenExt);
 
  try {
    const response = await fetch('/transcribe', {
      method: 'POST',
      body: formData
    });
   
    const data = await response.json();
    processingSection.classList.add('hidden');
   
    if (data.error) {
      statusText.textContent = data.error;
      if (currentRaw) {
        resultSection.classList.remove('hidden');
      }
      return;
    }
   
    if (data.text) {
      // Reset refine state for the new transcription
      currentRaw = data.text;
      currentRefined = '';
      currentView = 'original';
      viewToggle.classList.add('hidden');
      hideRefineMenu();

      // Show result
      resultSection.classList.remove('hidden');
      resultText.textContent = data.text;
      statusText.textContent = 'Tap to start recording';
     
      // Auto-copy to clipboard (server already copied to OS clipboard via pbcopy)
      copyToClipboard(data.text, { serverCopied: Boolean(data.copied) });
     
      // Add to history
      currentHistoryItem = addToHistory(data.text);
    }
  } catch (err) {
    console.error('Transcription error:', err);
    processingSection.classList.add('hidden');
    if (currentRaw) {
      resultSection.classList.remove('hidden');
    }
    statusText.textContent = 'Error: Could not connect to server';
  } finally {
    isProcessing = false;
  }
}

// Read current text from the editable result box, preserving line breaks
function getDisplayedResultText() {
  return (resultText.innerText || resultText.textContent || '').trim();
}

// Copy current result (whatever view is showing, including manual edits)
function copyText() {
  const text = getDisplayedResultText();
  if (text) {
    copyToClipboard(text);
  }
}

// Refine menu toggle
function toggleRefineMenu(event) {
  if (event) event.stopPropagation();
  if (refineMenu.classList.contains('hidden')) {
    refineMenu.classList.remove('hidden');
    refineBtn.setAttribute('aria-expanded', 'true');
  } else {
    hideRefineMenu();
  }
}

function hideRefineMenu() {
  refineMenu.classList.add('hidden');
  refineBtn.setAttribute('aria-expanded', 'false');
}

// Refine the current transcription with the local LLM
async function refineText(mode) {
  hideRefineMenu();
  if (isRefining) return;

  // Always refine from the original transcription text
  const source = currentRaw.trim();
  if (!source) return;

  isRefining = true;
  refineBtn.disabled = true;
  refineStatus.classList.remove('hidden');
  refineStatusText.textContent = 'Refining with local AI…';

  try {
    const response = await fetch('/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: source, mode })
    });
    const data = await response.json();

    if (data.error) {
      refineStatusText.textContent = data.error;
      refineStatus.classList.add('error');
      setTimeout(() => {
        refineStatus.classList.add('hidden');
        refineStatus.classList.remove('error');
      }, 6000);
      return;
    }

    currentRefined = data.refined;
    if (currentHistoryItem) {
      currentHistoryItem.refined = data.refined;
      renderHistory();
    }

    refineStatus.classList.add('hidden');
    viewToggle.classList.remove('hidden');
    setView('refined', false);
    copyToClipboard(data.refined, { serverCopied: Boolean(data.copied) });
  } catch (err) {
    console.error('Refine error:', err);
    refineStatusText.textContent = 'Error: Could not reach the refine service';
    refineStatus.classList.add('error');
    setTimeout(() => {
      refineStatus.classList.add('hidden');
      refineStatus.classList.remove('error');
    }, 6000);
  } finally {
    isRefining = false;
    refineBtn.disabled = false;
  }
}

// Switch between the original transcription and the refined version
function setView(view, shouldCopy = true) {
  currentView = view;
  if (view === 'refined') {
    resultText.textContent = currentRefined;
    viewRefinedBtn.classList.add('active');
    viewOriginalBtn.classList.remove('active');
    if (shouldCopy && currentRefined) {
      copyToClipboard(currentRefined);
    }
  } else {
    resultText.textContent = currentRaw;
    viewOriginalBtn.classList.add('active');
    viewRefinedBtn.classList.remove('active');
    if (shouldCopy && currentRaw) {
      copyToClipboard(currentRaw);
    }
  }
}

function showCopiedFeedback(historyBtn = null) {
  copyBtn.classList.add('copied');
  copyBtnText.textContent = 'Copied!';
  if (copyTimeout) clearTimeout(copyTimeout);
  copyTimeout = setTimeout(() => {
    copyBtn.classList.remove('copied');
    copyBtnText.textContent = 'Copy';
  }, 2000);

  if (historyBtn) {
    historyBtn.textContent = 'Copied!';
    setTimeout(() => {
      if (historyBtn.isConnected) {
        historyBtn.textContent = 'Copy';
      }
    }, 1500);
  }
}

// Copy to clipboard helper — uses both browser Clipboard API and backend OS
// clipboard (pbcopy on macOS) so copying always works even when switching
// between the Dictate window and other applications.
async function copyToClipboard(text, options = {}) {
  if (!text) return;
  const { serverCopied = false, quiet = false, historyBtn = null } = options;
  let copiedOk = Boolean(serverCopied);

  // 1. Try browser Clipboard API when window has focus
  if (navigator.clipboard && document.hasFocus()) {
    try {
      await navigator.clipboard.writeText(text);
      copiedOk = true;
      pendingClipboardText = '';
    } catch (_) {
      pendingClipboardText = text;
    }
  } else {
    pendingClipboardText = text;
  }

  // 2. Always ensure OS clipboard is updated via backend if not already done
  if (!serverCopied) {
    try {
      const resp = await fetch('/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (resp.ok) {
        const resData = await resp.json();
        if (resData.copied) {
          copiedOk = true;
        }
      }
    } catch (_) {
      // Ignore network errors and fall back to execCommand if needed
    }
  }

  // 3. Last-resort DOM fallback only if neither succeeded and document is focused
  if (!copiedOk && document.hasFocus()) {
    try {
      const prevActive = document.activeElement;
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      copiedOk = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (prevActive && typeof prevActive.focus === 'function') {
        prevActive.focus({ preventScroll: true });
      }
    } catch (_) {
      // Ignore fallback errors
    }
  }

  if (copiedOk && !quiet) {
    showCopiedFeedback(historyBtn);
  }
}

// Keep state and clipboard in sync when the user manually edits #resultText
resultText.addEventListener('input', () => {
  const edited = getDisplayedResultText();
  if (currentView === 'refined') {
    currentRefined = edited;
    if (currentHistoryItem) {
      currentHistoryItem.refined = edited;
      renderHistory();
    }
  } else {
    currentRaw = edited;
    if (currentHistoryItem) {
      currentHistoryItem.raw = edited;
      renderHistory();
    }
  }

  if (editSyncTimeout) clearTimeout(editSyncTimeout);
  if (edited) {
    editSyncTimeout = setTimeout(() => {
      copyToClipboard(edited, { quiet: true });
    }, 300);
  }
});

resultText.addEventListener('blur', () => {
  if (editSyncTimeout) {
    clearTimeout(editSyncTimeout);
    editSyncTimeout = null;
  }
  const edited = getDisplayedResultText();
  if (edited) {
    copyToClipboard(edited, { quiet: true });
  }
});

// History management
function addToHistory(text) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const item = { raw: text, refined: '', time };
  history.unshift(item);
 
  if (history.length > 50) history.pop();
 
  renderHistory();
  return item;
}

function renderHistory() {
  if (history.length === 0) {
    historyCard.classList.add('hidden');
    return;
  }
 
  historyCard.classList.remove('hidden');
  historyList.innerHTML = history.map((item, i) => {
    const display = item.refined || item.raw;
    const badge = item.refined ? '<span class="history-badge">Refined</span>' : '';
    return `
    <div class="history-item">
      <div class="history-item-main">
        <div class="history-item-text">${escapeHtml(display)}</div>
        <div class="history-item-meta">${badge}<span class="history-item-time">${item.time}</span></div>
      </div>
      <button class="history-item-copy" onclick="copyHistoryItem(${i}, this)">Copy</button>
    </div>`;
  }).join('');
}

function copyHistoryItem(index, btnEl = null) {
  const item = history[index];
  if (!item) return;
  copyToClipboard(item.refined || item.raw, { historyBtn: btnEl });
}

function clearHistory() {
  history = [];
  renderHistory();
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Close the refine menu when clicking elsewhere
document.addEventListener('click', (e) => {
  if (!refineMenu.classList.contains('hidden') &&
      !e.target.closest('.refine-wrap')) {
    hideRefineMenu();
  }
});

// Keyboard shortcuts:
// - Option + . to toggle recording (on macOS, Option+. produces '≥' with code 'Period')
// - Cmd/Ctrl + C with no text selection copies the current transcription
document.addEventListener('keydown', (e) => {
  if (e.altKey && (e.code === 'Period' || e.key === '.' || e.key === '≥')) {
    e.preventDefault();
    toggleRecording();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
    const selection = window.getSelection ? window.getSelection().toString() : '';
    if (!selection && !resultSection.classList.contains('hidden')) {
      const text = getDisplayedResultText();
      if (text) {
        e.preventDefault();
        copyToClipboard(text);
      }
    }
  }
  if (e.key === 'Escape') {
    hideRefineMenu();
  }
});

// Track pointer state so clicking a button (e.g. Copy / Refine) when switching
// from another app doesn't have its focus or scroll position hijacked.
window.addEventListener('pointerdown', () => { isPointerDown = true; }, true);
window.addEventListener('pointerup', () => { isPointerDown = false; }, true);
window.addEventListener('pointercancel', () => { isPointerDown = false; }, true);

// Focus record button when returning to the app window via keyboard/App Switcher,
// and flush any pending browser clipboard write.
window.addEventListener('focus', () => {
  notifyLifecycle('heartbeat');
  if (pendingClipboardText && navigator.clipboard) {
    const textToSync = pendingClipboardText;
    pendingClipboardText = '';
    navigator.clipboard.writeText(textToSync).catch(() => {});
  }
  if (!isPointerDown && document.activeElement !== resultText) {
    recordBtn.focus({ preventScroll: true });
  }
});

// Window lifecycle reporting so closing the app window on macOS stops the server
function notifyLifecycle(action) {
  const payload = JSON.stringify({ clientId });
  if (action === 'close') {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/lifecycle/close', blob);
    } else {
      fetch('/lifecycle/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }
    return;
  }
  fetch(`/lifecycle/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload
  }).catch(() => {});
}

notifyLifecycle('open');
window.addEventListener('pagehide', () => notifyLifecycle('close'));
window.addEventListener('beforeunload', () => notifyLifecycle('close'));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    notifyLifecycle('heartbeat');
  }
});