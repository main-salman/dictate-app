// State
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let history = [];
let chosenMimeType = 'audio/webm';
let chosenExt = 'webm';

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
      sendAudio(audioBlob);
    };
    
    mediaRecorder.start(); // Single blob on stop – avoids corrupt EBML header
    isRecording = true;
    
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
      // Show result
      resultSection.classList.remove('hidden');
      resultText.textContent = data.text;
      statusText.textContent = 'Tap to start recording';
      
      // Auto-copy to clipboard
      copyToClipboard(data.text);
      
      // Add to history
      addToHistory(data.text);
    }
  } catch (err) {
    console.error('Transcription error:', err);
    processingSection.classList.add('hidden');
    statusText.textContent = 'Error: Could not connect to server';
  }
}

// Copy current result
function copyText() {
  const text = resultText.textContent || resultText.innerText;
  copyToClipboard(text);
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
  history.unshift({ text, time });
  
  if (history.length > 50) history.pop();
  
  renderHistory();
}

function renderHistory() {
  if (history.length === 0) {
    historyCard.classList.add('hidden');
    return;
  }
  
  historyCard.classList.remove('hidden');
  historyList.innerHTML = history.map((item, i) => `
    <div class="history-item">
      <div>
        <div class="history-item-text">${escapeHtml(item.text)}</div>
        <div class="history-item-time">${item.time}</div>
      </div>
      <button class="history-item-copy" onclick="copyHistoryItem(${i})">Copy</button>
    </div>
  `).join('');
}

function copyHistoryItem(index) {
  copyToClipboard(history[index].text);
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

// Keyboard shortcut: Option + . to toggle recording
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key === '.') {
    e.preventDefault();
    toggleRecording();
  }
});
