/**
 * Frontend UI logic for the WhatsApp Bulk Campaign Tool.
 * Communicates with the Node.js backend via Socket.IO.
 */

(function () {
  const socket = io();

  // Elements
  const elLicenseText = document.getElementById('license-text');
  const elBtnConnect = document.getElementById('btn-connect');
  const elBtnDisconnect = document.getElementById('btn-disconnect');
  const elQrContainer = document.getElementById('qr-container');
  const elQrImage = document.getElementById('qr-image');
  const elConnectionStatus = document.getElementById('connection-status');

  const elFileInput = document.createElement('input');
  elFileInput.type = 'file';
  elFileInput.accept = '.txt';

  const elBtnImport = document.getElementById('btn-import');
  const elBtnClearNumbers = document.getElementById('btn-clear-numbers');
  const elNumbersCount = document.getElementById('numbers-count');
  const elNumbersPreview = document.getElementById('numbers-preview');

  const elCampaignMessage = document.getElementById('campaign-message');
  const elBtnSaveMessage = document.getElementById('btn-save-message');

  const elDelayMin = document.getElementById('delay-min');
  const elDelayMax = document.getElementById('delay-max');
  const elBtnSaveDelay = document.getElementById('btn-save-delay');

  const elAutoreplyEnabled = document.getElementById('autoreply-enabled');
  const elOpenAIKey = document.getElementById('openai-key');
  const elOpenAIModel = document.getElementById('openai-model');
  const elBtnSaveAutoreply = document.getElementById('btn-save-autoreply');

  const elBtnStart = document.getElementById('btn-start');
  const elBtnStop = document.getElementById('btn-stop');
  const elProgressFill = document.getElementById('progress-fill');
  const elStatTotal = document.getElementById('stat-total');
  const elStatSent = document.getElementById('stat-sent');
  const elStatFailed = document.getElementById('stat-failed');
  const elStatRemaining = document.getElementById('stat-remaining');

  const elStatusBar = document.getElementById('status-bar');

  let isConnected = false;
  let isRunning = false;

  // Helpers
  function setStatus(message) {
    elStatusBar.textContent = `Durum: ${message} / Status: ${message}`;
  }

  function setError(message) {
    elStatusBar.textContent = `HATA / ERROR: ${message}`;
    elStatusBar.style.color = '#e74c3c';
    setTimeout(() => {
      elStatusBar.style.color = '#b0b3b8';
    }, 3000);
  }

  function updateConnectionUI(ready) {
    isConnected = ready;
    elConnectionStatus.textContent = ready ? 'Status: Connected' : 'Status: Disconnected';
    elBtnConnect.disabled = ready;
    elBtnDisconnect.disabled = !ready;
    if (ready) {
      elQrContainer.classList.add('hidden');
    }
    updateStartButton();
  }

  function updateStats(stats) {
    elStatTotal.textContent = stats.total;
    elStatSent.textContent = stats.sent;
    elStatFailed.textContent = stats.failed;
    elStatRemaining.textContent = stats.remaining;

    const progress = stats.total > 0 ? ((stats.sent + stats.failed) / stats.total) * 100 : 0;
    elProgressFill.style.width = `${progress}%`;
  }

  function setRunning(running) {
    isRunning = running;
    updateStartButton();
    elBtnStop.disabled = !running;
  }

  function updateStartButton() {
    elBtnStart.disabled = isRunning || !isConnected;
  }

  function updateLicenseUI(license) {
    elLicenseText.textContent = license.isActive
      ? `${license.type} - Active`
      : 'Free Version - Inactive';
  }

  // Socket event listeners
  socket.on('connect', () => {
    setStatus('Connected to dashboard server.');
  });

  socket.on('disconnect', () => {
    setError('Lost connection to server.');
  });

  socket.on('status', (message) => setStatus(message));
  socket.on('error', (message) => setError(message));

  socket.on('app:license', (license) => updateLicenseUI(license));

  socket.on('whatsapp:qr', (qrDataUrl) => {
    elQrImage.src = qrDataUrl;
    elQrContainer.classList.remove('hidden');
    setStatus('QR code ready. Scan to connect.');
  });

  socket.on('whatsapp:ready', (ready) => {
    updateConnectionUI(ready);
    if (ready) {
      setStatus('WhatsApp connected and ready.');
    }
  });

  socket.on('numbers:updated', (numbers) => {
    elNumbersCount.textContent = numbers.length;
    elNumbersPreview.value = numbers.join('\n');
  });

  socket.on('campaign:started', (stats) => {
    updateStats(stats);
    setRunning(true);
    setStatus('Campaign started.');
  });

  socket.on('campaign:progress', (stats) => {
    updateStats(stats);
  });

  socket.on('campaign:finished', (stats) => {
    updateStats(stats);
    setRunning(false);
    setStatus('Campaign finished.');
  });

  // UI handlers
  elBtnConnect.addEventListener('click', () => {
    socket.emit('whatsapp:connect');
    setStatus('Connecting WhatsApp...');
  });

  elBtnDisconnect.addEventListener('click', () => {
    socket.emit('whatsapp:disconnect');
    updateConnectionUI(false);
    setStatus('Disconnected.');
  });

  elBtnImport.addEventListener('click', () => {
    elFileInput.click();
  });

  elFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const rawText = e.target.result;
      socket.emit('numbers:import', rawText, (result) => {
        if (result.success) {
          setStatus(`${result.count} numbers imported from ${file.name}.`);
        }
      });
    };
    reader.readAsText(file);
    elFileInput.value = '';
  });

  elBtnClearNumbers.addEventListener('click', () => {
    socket.emit('numbers:clear', (result) => {
      if (result.success) {
        setStatus('Number list cleared.');
      }
    });
  });

  elBtnSaveMessage.addEventListener('click', () => {
    socket.emit('campaign:set-message', elCampaignMessage.value, () => {
      setStatus('Campaign message saved.');
    });
  });

  elBtnSaveDelay.addEventListener('click', () => {
    const min = parseInt(elDelayMin.value, 10);
    const max = parseInt(elDelayMax.value, 10);
    if (isNaN(min) || isNaN(max) || min < 1 || max < 1) {
      setError('Please enter valid delay values.');
      return;
    }
    if (min > max) {
      setError('Minimum delay cannot be greater than maximum delay.');
      return;
    }
    socket.emit('campaign:set-delay', { minDelay: min, maxDelay: max }, () => {
      setStatus(`Anti-ban delay set: ${min}s - ${max}s.`);
    });
  });

  elBtnSaveAutoreply.addEventListener('click', () => {
    const enabled = elAutoreplyEnabled.checked;
    const apiKey = elOpenAIKey.value.trim();
    const model = elOpenAIModel.value.trim() || 'gpt-4o-mini';

    if (enabled && !apiKey) {
      setError('Please enter an OpenAI API key to enable auto-reply.');
      return;
    }

    socket.emit('autoreply:configure', { enabled, apiKey, model }, () => {
      setStatus(enabled ? 'AI auto-reply enabled.' : 'AI auto-reply disabled.');
    });
  });

  elBtnStart.addEventListener('click', () => {
    if (!isConnected) {
      setError('WhatsApp is not connected.');
      return;
    }
    socket.emit('campaign:start', (result) => {
      if (!result.success) {
        setError(result.error);
      }
    });
  });

  elBtnStop.addEventListener('click', () => {
    socket.emit('campaign:stop');
    setStatus('Stop requested.');
  });

  // Initialize
  setStatus('Ready and Waiting...');
})();
