/**
 * Frontend UI logic for the WhatsApp Bulk Campaign Tool.
 * Communicates with the Node.js backend via Socket.IO.
 */

(function () {
  const socket = io();

  // Elements
  const elLicenseText = document.getElementById('license-text');
  const elBtnConnect = document.getElementById('btn-connect');
  const elBtnConnectPhone = document.getElementById('btn-connect-phone');
  const elPhoneNumber = document.getElementById('phone-number');
  const elBtnDisconnect = document.getElementById('btn-disconnect');
  const elBtnLogout = document.getElementById('btn-logout');
  const elProxyUrl = document.getElementById('proxy-url');
  const elBtnSetProxy = document.getElementById('btn-set-proxy');
  const elQrContainer = document.getElementById('qr-container');
  const elQrImage = document.getElementById('qr-image');
  const elPairingCodeContainer = document.getElementById('pairing-code-container');
  const elPairingCode = document.getElementById('pairing-code');
  const elConnectionStatus = document.getElementById('connection-status');

  const elAccountsSelect = document.getElementById('accounts-select');
  const elBtnSwitchAccount = document.getElementById('btn-switch-account');
  const elBtnRemoveAccount = document.getElementById('btn-remove-account');
  const elBtnAddAccount = document.getElementById('btn-add-account');
  const elNewAccountLabel = document.getElementById('new-account-label');
  const elAccountsTbody = document.getElementById('accounts-tbody');
  const elRotationEnabled = document.getElementById('rotation-enabled');
  const elRotationMax = document.getElementById('rotation-max');
  const elRotationPause = document.getElementById('rotation-pause');
  const elBtnSaveRotation = document.getElementById('btn-save-rotation');

  const elFileInput = document.createElement('input');
  elFileInput.type = 'file';
  elFileInput.accept = '.txt';

  const elBtnImport = document.getElementById('btn-import');
  const elBtnClearNumbers = document.getElementById('btn-clear-numbers');
  const elInputAddNumber = document.getElementById('input-add-number');
  const elBtnAddNumber = document.getElementById('btn-add-number');
  const elNumbersCount = document.getElementById('numbers-count');
  const elNumbersPreview = document.getElementById('numbers-preview');

  const elCampaignMessage = document.getElementById('campaign-message');
  const elBtnSaveMessage = document.getElementById('btn-save-message');

  const elDelayMin = document.getElementById('delay-min');
  const elDelayMax = document.getElementById('delay-max');
  const elBtnSaveDelay = document.getElementById('btn-save-delay');

  const elAutoreplyEnabled = document.getElementById('autoreply-enabled');
  const elAutoreplyProvider = document.getElementById('autoreply-provider');
  const elAutoreplyModel = document.getElementById('autoreply-model');
  const elModelSuggestions = document.getElementById('model-suggestions');
  const elAiApiKey = document.getElementById('ai-api-key');
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
    elBtnConnectPhone.disabled = ready;
    elBtnDisconnect.disabled = !ready;
    elBtnLogout.disabled = !ready;
    if (ready) {
      elQrContainer.classList.add('hidden');
      elPairingCodeContainer.classList.add('hidden');
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
    elPairingCodeContainer.classList.add('hidden');
    setStatus('QR code ready. Scan to connect.');
  });

  socket.on('whatsapp:pairingCode', (code) => {
    elPairingCode.textContent = code;
    elPairingCodeContainer.classList.remove('hidden');
    elQrContainer.classList.add('hidden');
    setStatus('Pairing code received. Enter it in WhatsApp.');
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

  socket.on('whatsapp:proxy', (proxy) => {
    elProxyUrl.value = proxy || '';
  });

  socket.on('accounts:updated', (state) => renderAccounts(state));

  socket.on('campaign:rotation', (options) => {
    elRotationEnabled.checked = Boolean(options.enabled);
    elRotationMax.value = options.maxPerAccount;
    elRotationPause.value = options.switchPauseSeconds;
  });

  // AI auto-reply providers and current config
  let aiProviders = {};

  function updateModelSuggestions() {
    const info = aiProviders[elAutoreplyProvider.value];
    elModelSuggestions.innerHTML = '';
    for (const model of (info ? info.models : [])) {
      const option = document.createElement('option');
      option.value = model;
      elModelSuggestions.appendChild(option);
    }
  }

  socket.on('autoreply:providers', (providers) => {
    aiProviders = providers || {};
    elAutoreplyProvider.innerHTML = '';
    for (const [id, info] of Object.entries(aiProviders)) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = info.label;
      elAutoreplyProvider.appendChild(option);
    }
    updateModelSuggestions();
  });

  socket.on('autoreply:config', (config) => {
    elAutoreplyEnabled.checked = Boolean(config.enabled);
    if (config.provider && aiProviders[config.provider]) {
      elAutoreplyProvider.value = config.provider;
    }
    updateModelSuggestions();
    elAutoreplyModel.value = config.model || '';
  });

  elAutoreplyProvider.addEventListener('change', updateModelSuggestions);

  // If the provider catalog never arrives, the dashboard server is running
  // outdated code (started before this update) — say so instead of leaving
  // a silent empty list.
  setTimeout(() => {
    if (elAutoreplyProvider.options.length === 0) {
      setError('Provider list is empty: restart the tool (npm start) to load the new server code.');
    }
  }, 3000);

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
    setStatus('Connecting WhatsApp via QR...');
  });

  elBtnConnectPhone.addEventListener('click', () => {
    const phone = elPhoneNumber.value.trim();
    if (!phone) {
      setError('Please enter your phone number.');
      return;
    }
    socket.emit('whatsapp:connect-phone', phone, (result) => {
      if (!result.success) {
        setError(result.error);
      } else {
        setStatus('Requesting pairing code...');
      }
    });
  });

  elBtnDisconnect.addEventListener('click', () => {
    socket.emit('whatsapp:disconnect');
    updateConnectionUI(false);
    setStatus('Disconnected.');
  });

  elBtnLogout.addEventListener('click', () => {
    socket.emit('whatsapp:logout', null, (result) => {
      if (result.success) {
        updateConnectionUI(false);
        setStatus('Logged out and session cleared.');
      }
    });
  });

  elBtnSetProxy.addEventListener('click', () => {
    socket.emit('whatsapp:set-proxy', elProxyUrl.value.trim(), (result) => {
      if (result.success) {
        const account = accountsState.accounts.find((a) => a.id === accountsState.activeId);
        setStatus(result.proxy
          ? `Proxy saved for "${account ? account.label : 'active account'}". Applies on its next connection.`
          : 'Proxy cleared for the active account.');
      } else {
        setError(result.error);
      }
    });
  });

  // Accounts management
  let accountsState = { accounts: [], activeId: null };

  function renderAccounts(state) {
    accountsState = state;

    elAccountsSelect.innerHTML = '';
    for (const account of state.accounts) {
      const option = document.createElement('option');
      option.value = account.id;
      option.textContent = account.label + (account.id === state.activeId ? ' (active)' : '');
      elAccountsSelect.appendChild(option);
    }
    if (state.activeId) {
      elAccountsSelect.value = state.activeId;
    }

    // The proxy field always shows the active account's own proxy.
    const active = state.accounts.find((a) => a.id === state.activeId);
    elProxyUrl.value = (active && active.proxy) || '';

    elAccountsTbody.innerHTML = '';
    for (const account of state.accounts) {
      const row = document.createElement('tr');
      if (account.id === state.activeId) {
        row.classList.add('active-account');
      }
      const name = document.createElement('td');
      name.textContent = account.id === state.activeId ? `${account.label} ★` : account.label;
      const linked = document.createElement('td');
      linked.textContent = account.hasSession ? 'Yes' : 'No';
      const proxy = document.createElement('td');
      proxy.textContent = proxyDisplay(account.proxy);
      const sent = document.createElement('td');
      sent.textContent = account.stats.sent;
      const failed = document.createElement('td');
      failed.textContent = account.stats.failed;
      row.append(name, linked, proxy, sent, failed);
      elAccountsTbody.appendChild(row);
    }

    const selectedId = elAccountsSelect.value;
    elBtnSwitchAccount.disabled = !selectedId || selectedId === state.activeId;
  }

  function proxyDisplay(proxyUrl) {
    if (!proxyUrl) {
      return '—';
    }
    try {
      const url = new URL(proxyUrl);
      return `${url.hostname}:${url.port}`;
    } catch (err) {
      return 'set';
    }
  }

  elBtnAddAccount.addEventListener('click', () => {
    const label = elNewAccountLabel.value.trim();
    if (!label) {
      setError('Enter a name for the new account.');
      return;
    }
    socket.emit('accounts:add', { label }, (result) => {
      if (result.success) {
        elNewAccountLabel.value = '';
        setStatus(`Account "${result.account.label}" added. Select it and connect to link the number.`);
      }
    });
  });

  elBtnRemoveAccount.addEventListener('click', () => {
    const id = elAccountsSelect.value;
    if (!id) {
      setError('Select an account to remove.');
      return;
    }
    const account = accountsState.accounts.find((a) => a.id === id);
    if (!window.confirm(`Remove account "${account ? account.label : id}" and delete its linked session?`)) {
      return;
    }
    socket.emit('accounts:remove', { id }, (result) => {
      if (result.success) {
        setStatus('Account removed.');
      } else {
        setError(result.error);
      }
    });
  });

  elBtnSwitchAccount.addEventListener('click', () => {
    const id = elAccountsSelect.value;
    if (!id) {
      return;
    }
    socket.emit('accounts:switch', { id }, (result) => {
      if (!result.success) {
        setError(result.error);
      } else if (result.autoRestored) {
        setStatus('Switched. Restoring saved session...');
      }
    });
  });

  elBtnSaveRotation.addEventListener('click', () => {
    const max = parseInt(elRotationMax.value, 10);
    const pause = parseInt(elRotationPause.value, 10);
    if (isNaN(max) || max < 1) {
      setError('Messages per account must be at least 1.');
      return;
    }
    if (isNaN(pause) || pause < 1) {
      setError('Switch pause must be at least 1 second.');
      return;
    }
    const enabled = elRotationEnabled.checked;
    socket.emit(
      'campaign:set-rotation',
      { enabled, maxPerAccount: max, switchPauseSeconds: pause },
      (result) => {
        if (result.success) {
          setStatus(enabled
            ? `Rotation on: switch account after ${max} messages, pause ${pause}s.`
            : `Rotation saved (off): ${max} messages/pause ${pause}s.`);
        }
      },
    );
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

  elBtnAddNumber.addEventListener('click', () => {
    const raw = elInputAddNumber.value.trim();
    if (!raw) {
      setError('Please enter at least one phone number.');
      return;
    }
    socket.emit('numbers:add', raw, (result) => {
      if (result.success) {
        setStatus(`${result.added} number(s) added. Total: ${result.count}.`);
        elInputAddNumber.value = '';
      }
    });
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
    const provider = elAutoreplyProvider.value;
    const model = elAutoreplyModel.value.trim();
    const apiKey = elAiApiKey.value.trim();

    if (!model) {
      setError('Please enter or pick a model.');
      return;
    }

    socket.emit('autoreply:configure', { enabled, provider, model, apiKey }, (result) => {
      if (!result.success) {
        setError(result.error);
        return;
      }
      elAiApiKey.value = '';
      const cfg = result.config;
      setStatus(`AI auto-reply ${cfg.enabled ? 'enabled' : 'disabled'}: ${cfg.provider} / ${cfg.model}${cfg.keyHint ? ` (key ${cfg.keyHint})` : ''}.`);
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
