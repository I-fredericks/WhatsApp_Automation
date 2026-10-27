
(function () {
  const socket = io();
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---------- state ---------- */
  let accountsState = { accounts: [], activeId: null };
  let numbers = [];
  let campaignMessage = '';
  let isConnected = false;
  let isRunning = false;
  let campaignStats = { total: 0, sent: 0, failed: 0, remaining: 0 };
  let license = { isActive: true, type: 'VIP Version' };
  let aiProviders = {};
  let aiConfig = { enabled: false, provider: 'openai', model: 'gpt-4o-mini', keyHint: null };

  /* ---------- theme ---------- */
  const applyTheme = t => document.documentElement.dataset.theme = t;
  applyTheme(localStorage.getItem('wbc_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(t); localStorage.setItem('wbc_theme', t); };

  /* ---------- navigation ---------- */
  const titles = {
    overview: ['Overview', 'Live status of your WhatsApp sending'],
    accounts: ['Accounts', 'Manage lines and rotation'],
    contacts: ['Contacts', 'Import and manage your number list'],
    campaign: ['Campaign', 'Compose your message and set delays'],
    automation: ['Automation', 'AI-powered auto-reply'],
    connection: ['Connection', 'Link WhatsApp and configure a proxy']
  };
  function go(v) {
    document.querySelectorAll('.view').forEach(e => e.classList.toggle('active', e.id === 'view-' + v));
    document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.view === v));
    $('pageTitle').textContent = titles[v][0];
    $('pageSub').textContent = titles[v][1];
    $('sidebar').classList.remove('open');
    $('scrim').classList.remove('show');
    history.replaceState(null, '', '#' + v);
  }
  $('nav').addEventListener('click', e => { const a = e.target.closest('a'); if (a) go(a.dataset.view); });
  $('menuBtn').onclick = () => { $('sidebar').classList.toggle('open'); $('scrim').classList.toggle('show'); };
  $('scrim').onclick = () => { $('sidebar').classList.remove('open'); $('scrim').classList.remove('show'); };

  /* ---------- toast + log ---------- */
  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = (type === 'ok'
      ? '<svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg>'
      : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16v.01"/></svg>') + '<span>' + esc(msg) + '</span>';
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
  function log(msg, cls = '') {
    const d = document.createElement('div');
    const t = new Date().toLocaleTimeString([], { hour12: false });
    d.innerHTML = '<span class="t">[' + t + ']</span> <span class="' + cls + '">' + esc(msg) + '</span>';
    const l = $('log');
    l.appendChild(d);
    l.scrollTop = l.scrollHeight;
  }

  /* ---------- modal ---------- */
  function modal(title, sub, body) {
    $('mTitle').textContent = title;
    $('mSub').textContent = sub;
    $('mBody').innerHTML = body;
    $('modal').classList.add('open');
  }
  const closeModal = () => $('modal').classList.remove('open');
  $('mClose').onclick = closeModal;
  $('modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
  document.addEventListener('keydown', e => e.key === 'Escape' && closeModal());

  /* ---------- render ---------- */
  const activeAcc = () => accountsState.accounts.find(a => a.id === accountsState.activeId);
  function proxyDisplay(proxyUrl) {
    if (!proxyUrl) return '—';
    try { const u = new URL(proxyUrl); return `${u.hostname}:${u.port}`; } catch (e) { return 'set'; }
  }
  function renderAccounts() {
    const tbody = $('accBody');
    if (!accountsState.accounts.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">No accounts yet.</td></tr>';
      return;
    }
    tbody.innerHTML = accountsState.accounts.map(a => {
      const isActive = a.id === accountsState.activeId;
      return `<tr>
        <td><div class="acct"><div class="avatar">${esc(a.label.slice(0, 1).toUpperCase())}</div><div><b>${esc(a.label)}</b><small>${isActive ? 'Active account' : 'Standby'}</small></div></div></td>
        <td><span class="pill ${a.hasSession ? 'ok' : ''}"><i></i>${a.hasSession ? 'Linked' : 'Not linked'}</span></td>
        <td>${esc(proxyDisplay(a.proxy))}</td>
        <td>${a.stats.sent}</td>
        <td>${a.stats.failed}</td>
        <td style="text-align:right;white-space:nowrap">
          ${!isActive ? `<button class="btn sm" data-act="switch" data-id="${esc(a.id)}">Switch to</button> ` : ''}
          ${accountsState.accounts.length > 1 ? `<button class="btn sm danger" data-act="remove" data-id="${esc(a.id)}">Remove</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    $('navAcc').textContent = accountsState.accounts.length;
  }
  function renderContacts() {
    $('conCount').textContent = numbers.length;
    $('navCon').textContent = numbers.length;
    $('chips').innerHTML = numbers.slice(0, 400).map((n, i) => `<span class="chip">${esc(n)}<button data-rm="${i}" aria-label="Remove">×</button></span>`).join('')
      + (numbers.length > 400 ? `<span class="hint" style="align-self:center">+${numbers.length - 400} more</span>` : '');
    $('chipsEmpty').style.display = numbers.length ? 'none' : 'block';
    $('chips').style.display = numbers.length ? 'flex' : 'none';
  }
  function renderStats() {
    const total = isRunning ? campaignStats.total : numbers.length;
    const sent = isRunning ? campaignStats.sent : 0;
    const failed = isRunning ? campaignStats.failed : 0;
    const remaining = Math.max(total - sent - failed, 0);
    $('sTotal').textContent = total;
    $('sSent').textContent = sent;
    $('sFailed').textContent = failed;
    $('sRemain').textContent = remaining;
    const pct = total ? Math.round((sent + failed) / total * 100) : 0;
    $('bar').style.width = pct + '%';
    $('ring').style.setProperty('--p', pct);
    $('ringPct').textContent = pct + '%';
    const rp = $('runPill');
    rp.className = 'pill ' + (isRunning ? 'ok live' : '');
    rp.lastElementChild.textContent = isRunning ? 'Running' : 'Idle';
    $('startBtn').disabled = isRunning || !isConnected;
    $('stopBtn').disabled = !isRunning;
    $('etaText').textContent = isRunning ? 'Campaign in progress…' : 'No campaign running.';
  }
  function renderChecklist() {
    const a = activeAcc();
    const linked = a && a.hasSession && isConnected;
    const items = [
      [linked, 'WhatsApp account linked'],
      [numbers.length > 0, 'Contacts imported (' + numbers.length + ')'],
      [campaignMessage.trim().length > 0, 'Campaign message saved'],
      [$('dMin').value && $('dMax').value && Number($('dMin').value) <= Number($('dMax').value), 'Delay range valid']
    ];
    $('checklist').innerHTML = items.map(([ok, t]) => `<div class="row"><span class="ico ${ok ? 'green' : 'amber'}" style="width:26px;height:26px;border-radius:50%;display:grid;place-items:center"><svg viewBox="0 0 24 24" style="width:14px;height:14px">${ok ? '<path d="m5 12 5 5L20 7"/>' : '<path d="M12 8v5M12 16v.01"/>'}</svg></span><span style="font-weight:500">${t}</span></div>`).join('');
  }
  function renderConnection() {
    const wp = $('waPill');
    wp.className = 'pill ' + (isConnected ? 'ok live' : 'err');
    wp.lastElementChild.textContent = isConnected ? 'WhatsApp connected' : 'WhatsApp disconnected';
    $('discBtn').disabled = !isConnected;
    $('resetBtn').disabled = !isConnected;
    $('qrBtn').disabled = isConnected;
    $('pairBtn').disabled = isConnected;
  }
  function renderLicense() {
    $('licType').textContent = license.type || 'Free Version';
    if (license.isActive) {
      $('licText').textContent = 'License active. All features unlocked.';
      $('licInputWrap').style.display = 'none';
    } else {
      $('licText').textContent = 'Free Version — activate a license to run campaigns.';
      $('licInputWrap').style.display = 'block';
    }
  }
  function render() {
    renderAccounts();
    renderContacts();
    renderStats();
    renderChecklist();
    renderConnection();
  }

  /* ---------- socket listeners ---------- */
  socket.on('connect', () => { log('Connected to dashboard server'); $('serverPill').className = 'pill ok'; $('serverPill').lastElementChild.textContent = 'Server online'; });
  socket.on('disconnect', () => { log('Lost connection to server', 'e'); $('serverPill').className = 'pill err'; $('serverPill').lastElementChild.textContent = 'Server offline'; });
  socket.on('status', (m) => log(m));
  socket.on('error', (m) => { log(m, 'e'); toast(m, 'err'); });
  socket.on('app:license', (l) => { license = l; renderLicense(); });
  socket.on('whatsapp:ready', (r) => { isConnected = r; render(); closeModal(); if (r) toast('WhatsApp connected'); });
  socket.on('campaign:started', (stats) => { isRunning = true; campaignStats = stats; render(); log('Campaign started · ' + stats.total + ' recipients'); });
  socket.on('campaign:progress', (stats) => { campaignStats = stats; render(); });
  socket.on('campaign:finished', (stats) => { isRunning = false; campaignStats = stats; render(); log('Campaign finished'); toast('Campaign finished'); });
  socket.on('numbers:updated', (n) => { numbers = n; render(); });
  socket.on('accounts:updated', (state) => { accountsState = state; const a = activeAcc(); if (a && a.proxy !== undefined) $('proxy').value = a.proxy || ''; render(); });
  socket.on('whatsapp:proxy', (p) => { $('proxy').value = p || ''; });
  socket.on('campaign:rotation', (opts) => { $('rotOn').checked = opts.enabled; $('rotAfter').value = opts.maxPerAccount; $('rotPause').value = opts.switchPauseSeconds; });
  socket.on('autoreply:providers', (providers) => {
    aiProviders = providers || {};
    const sel = $('aiProvider');
    sel.innerHTML = '';
    for (const [id, info] of Object.entries(aiProviders)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = info.label;
      sel.appendChild(opt);
    }
    updateModelSuggestions();
    if (aiConfig.provider && aiProviders[aiConfig.provider]) sel.value = aiConfig.provider;
  });
  socket.on('autoreply:config', (cfg) => {
    aiConfig = cfg;
    $('aiOn').checked = cfg.enabled;
    if (cfg.provider && aiProviders[cfg.provider]) $('aiProvider').value = cfg.provider;
    updateModelSuggestions();
    $('aiModel').value = cfg.model || '';
    $('aiBiz').value = cfg.businessContext || '';
  });
  socket.on('autoreply:replied', ({ to }) => log('AI replied to ' + to));
  socket.on('whatsapp:qr', (qrDataUrl) => { modal('Scan to connect', 'Open WhatsApp › Linked devices › Link a device.', '<div class="qr"><img src="' + esc(qrDataUrl) + '" alt="QR code"></div>'); });
  socket.on('whatsapp:pairingCode', (code) => { modal('Enter this code', 'On your phone: Linked devices › Link with phone number.', '<div class="code">' + esc(code) + '</div>'); });

  function updateModelSuggestions() {
    const info = aiProviders[$('aiProvider').value];
    const dl = $('modelSuggestions');
    dl.innerHTML = '';
    for (const m of (info ? info.models : [])) {
      const o = document.createElement('option');
      o.value = m;
      dl.appendChild(o);
    }
  }
  $('aiProvider').addEventListener('change', updateModelSuggestions);

  /* ---------- accounts ---------- */
  $('addAcc').onclick = () => {
    const n = $('accName').value.trim();
    if (!n) return toast('Enter an account name', 'err');
    socket.emit('accounts:add', { label: n }, (res) => { if (res.success) { $('accName').value = ''; log('Account "' + n + '" added'); } else toast(res.error, 'err'); });
  };
  $('accBody').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = b.dataset.id;
    if (b.dataset.act === 'switch') {
      if (isRunning) return toast('Stop the campaign before switching accounts', 'err');
      socket.emit('accounts:switch', { id }, (res) => { if (!res.success) toast(res.error, 'err'); });
    }
    if (b.dataset.act === 'remove') {
      if (isRunning) return toast('Stop the campaign before removing an account', 'err');
      socket.emit('accounts:remove', { id }, (res) => { if (!res.success) toast(res.error, 'err'); });
    }
  });
  $('saveRot').onclick = () => {
    const opts = { enabled: $('rotOn').checked, maxPerAccount: Number($('rotAfter').value) || 50, switchPauseSeconds: Number($('rotPause').value) || 0 };
    socket.emit('campaign:set-rotation', opts, (res) => { if (res.success) { toast('Rotation settings saved'); } else toast(res.error, 'err'); });
  };

  /* ---------- contacts ---------- */
  function addNumbers(text) {
    socket.emit('numbers:add', text, (res) => {
      if (res.success) {
        log(`Import: ${res.added} added, ${res.count} total`);
        toast(`${res.added} added · ${res.count} total`);
      } else {
        toast(res.error, 'err');
      }
    });
  }
  $('addNums').onclick = () => { addNumbers($('manual').value); $('manual').value = ''; };
  $('clearNums').onclick = () => socket.emit('numbers:clear', (res) => { if (res.success) { log('List cleared'); toast('List cleared'); } });
  $('chips').addEventListener('click', e => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    const idx = +b.dataset.rm;
    const next = numbers.slice(0, idx).concat(numbers.slice(idx + 1));
    socket.emit('numbers:import', next.join('\n'), (res) => { if (res.success) log('Number removed'); });
  });
  const drop = $('drop'), file = $('file');
  drop.onclick = () => file.click();
  file.onchange = () => file.files[0] && file.files[0].text().then(addNumbers);
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) f.text().then(addNumbers); });

  /* ---------- campaign ---------- */
  const updPrev = () => { const v = $('msg').value; $('prev').textContent = v || 'Your message will appear here…'; $('msgCount').textContent = v.length + ' characters'; };
  $('msg').oninput = updPrev;
  $('saveMsg').onclick = () => {
    socket.emit('campaign:set-message', $('msg').value, (res) => { if (res.success) { campaignMessage = $('msg').value; toast('Message saved'); render(); } });
  };
  $('saveDelay').onclick = () => {
    const mn = +$('dMin').value, mx = +$('dMax').value;
    if (!mn || !mx || mn > mx) return toast('Min delay must be ≤ max delay', 'err');
    socket.emit('campaign:set-delay', { minDelay: mn, maxDelay: mx }, (res) => { if (res.success) { toast('Delay settings saved'); render(); } });
  };

  /* ---------- automation ---------- */
  $('eye').onclick = () => { const k = $('aiKey'); k.type = k.type === 'password' ? 'text' : 'password'; };
  $('saveAi').onclick = () => {
    const opts = { enabled: $('aiOn').checked, provider: $('aiProvider').value, model: $('aiModel').value.trim(), apiKey: $('aiKey').value.trim(), businessContext: $('aiBiz').value.trim() };
    if (opts.enabled && !opts.apiKey && !aiConfig.keyHint) return toast('Enter an API key to enable auto-reply', 'err');
    socket.emit('autoreply:configure', opts, (res) => {
      if (res.success) {
        $('aiKey').value = '';
        toast(`Auto-reply ${res.config.enabled ? 'enabled' : 'disabled'} · ${res.config.provider}/${res.config.model}`);
      } else {
        toast(res.error, 'err');
      }
    });
  };

  /* ---------- connection ---------- */
  $('qrBtn').onclick = () => {
    modal('Scan to connect', 'Open WhatsApp › Linked devices › Link a device.', '<div class="qr"><div class="spin"></div></div>');
    socket.emit('whatsapp:connect', (res) => { if (!res.success) { closeModal(); toast(res.error, 'err'); } });
  };
  $('pairBtn').onclick = () => {
    const p = $('phone').value.replace(/\D/g, '');
    if (p.length < 7) return toast('Enter a valid phone number', 'err');
    modal('Requesting pairing code…', 'This can take up to a minute — the code appears here automatically. If this account already has a saved session, it reconnects instead and this closes by itself.', '<div class="qr"><div class="spin"></div></div>');
    socket.emit('whatsapp:connect-phone', { phoneNumber: p }, (res) => { if (!res.success) { closeModal(); toast(res.error, 'err'); } });
  };
  $('discBtn').onclick = () => socket.emit('whatsapp:disconnect');
  $('resetBtn').onclick = () => {
    if (!confirm('Log out and reset this session?')) return;
    socket.emit('whatsapp:logout', null, (res) => { if (res.success) { log('Logged out and reset', 'w'); toast('Session reset'); } });
  };
  $('setProxy').onclick = () => {
    socket.emit('whatsapp:set-proxy', $('proxy').value.trim(), (res) => {
      if (res.success) toast(res.proxy ? 'Proxy saved for active account' : 'Proxy cleared');
      else toast(res.error, 'err');
    });
  };

  /* ---------- license ---------- */
  $('activateLic').onclick = () => {
    const key = $('licKey').value.trim();
    socket.emit('app:activate-license', key, (res) => {
      if (res.success) toast('License activated');
      else toast(res.error || 'Invalid license', 'err');
    });
  };

  /* ---------- run campaign ---------- */
  $('startBtn').onclick = () => {
    if (!license.isActive) return toast('VIP license is not active', 'err');
    if (!isConnected) return toast('Link a WhatsApp account first', 'err');
    if (!numbers.length) { toast('Import contacts first', 'err'); return go('contacts'); }
    if (!campaignMessage.trim()) { toast('Save a campaign message first', 'err'); return go('campaign'); }
    socket.emit('campaign:start', (res) => { if (!res.success) toast(res.error, 'err'); });
  };
  $('stopBtn').onclick = () => socket.emit('campaign:stop');
  $('clearLog').onclick = () => $('log').innerHTML = '';

  /* ---------- init ---------- */
  const h = location.hash.slice(1);
  if (titles[h]) go(h);
  updPrev();
  log('Dashboard ready');
})();
