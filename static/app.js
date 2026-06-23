// State
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
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
  } else {
    await startRecording();
  }
}

// Start recording
async function startRecording() {
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
        processingSection.classList.add('hidden');
        resultSection.classList.add('hidden');
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
  }
}

// Stop recording
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
 
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
     
      // Auto-copy to clipboard
      copyToClipboard(data.text);
     
      // Add to history
      currentHistoryItem = addToHistory(data.text);
    }
  } catch (err) {
    console.error('Transcription error:', err);
    processingSection.classList.add('hidden');
    statusText.textContent = 'Error: Could not connect to server';
  }
}

// Copy current result (whatever view is showing, including manual edits)
function copyText() {
  const text = resultText.textContent || resultText.innerText;
  copyToClipboard(text);
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
    setView('refined');
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
function setView(view) {
  currentView = view;
  if (view === 'refined') {
    resultText.textContent = currentRefined;
    viewRefinedBtn.classList.add('active');
    viewOriginalBtn.classList.remove('active');
  } else {
    resultText.textContent = currentRaw;
    viewOriginalBtn.classList.add('active');
    viewRefinedBtn.classList.remove('active');
  }
}

// Copy to clipboard helper
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
   
    // Animate copy button
    copyBtn.classList.add('copied');
    copyBtnText.textContent = 'Copied!';
   
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtnText.textContent = 'Copy';
    }, 2000);
  } catch (err) {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

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
      <button class="history-item-copy" onclick="copyHistoryItem(${i})">Copy</button>
    </div>`;
  }).join('');
}

function copyHistoryItem(index) {
  const item = history[index];
  copyToClipboard(item.refined || item.raw);
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

// Keyboard shortcut: Option + . to toggle recording
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key === '.') {
    e.preventDefault();
    toggleRecording();
  }
  if (e.key === 'Escape') {
    hideRefineMenu();
  }
});

// Always focus the record button when returning to the app window
window.addEventListener('focus', () => {
  recordBtn.focus();
});