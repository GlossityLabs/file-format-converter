const api = window.formatForgeDesktop;

const elements = {
  statusPill: document.querySelector('#statusPill'),
  statusText: document.querySelector('#statusText'),
  engineTitle: document.querySelector('#engineTitle'),
  engineDescription: document.querySelector('#engineDescription'),
  engineError: document.querySelector('#engineError'),
  engineButton: document.querySelector('#engineButton'),
  browserBadge: document.querySelector('#browserBadge'),
  browserMessage: document.querySelector('#browserMessage'),
  registerButton: document.querySelector('#registerButton'),
  pairingToken: document.querySelector('#pairingToken'),
  revealButton: document.querySelector('#revealButton'),
  copyButton: document.querySelector('#copyButton'),
  recipeCount: document.querySelector('#recipeCount'),
  toolRefreshButton: document.querySelector('#toolRefreshButton'),
  toolsList: document.querySelector('#toolsList'),
  loginToggle: document.querySelector('#loginToggle'),
  updateTitle: document.querySelector('#updateTitle'),
  updateMessage: document.querySelector('#updateMessage'),
  updateVersion: document.querySelector('#updateVersion'),
  updateButton: document.querySelector('#updateButton'),
  updateProgress: document.querySelector('#updateProgress'),
  updateProgressBar: document.querySelector('#updateProgressBar'),
  toast: document.querySelector('#toast'),
};

let currentState;
let currentUpdateState;
let tokenVisible = false;
let toastTimer;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 3500);
}

function messageFromError(error) {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*/, '') : String(error);
}

function renderTools(capabilities) {
  const toolLabels = {
    libreoffice: 'Office documents',
    ffmpeg: 'Audio and video',
  };
  const helpUrls = {
    libreoffice: 'https://www.libreoffice.org/download/download-libreoffice/',
    ffmpeg: 'https://ffmpeg.org/download.html#build-mac',
  };
  const tools = capabilities?.tools;
  if (!tools) {
    const message = document.createElement('p');
    message.className = 'muted';
    message.textContent = 'Start the engine to detect installed conversion tools.';
    elements.toolsList.replaceChildren(message);
    elements.recipeCount.textContent = 'Not ready';
    return;
  }

  const rows = Object.entries(toolLabels).map(([id, label]) => {
    const tool = tools[id] ?? { available: false };
    const row = document.createElement('div');
    row.className = `tool-row${tool.available ? ' available' : ''}`;
    const dot = document.createElement('span');
    dot.className = 'tool-dot';
    const name = document.createElement('span');
    name.className = 'tool-name';
    name.textContent = label;
    const state = document.createElement('span');
    state.className = 'tool-state';
    state.textContent = tool.available ? 'Ready' : 'Not installed';
    row.append(dot, name, state);
    if (!tool.available && helpUrls[id]) {
      const help = document.createElement('button');
      help.className = 'tool-help-button';
      help.type = 'button';
      help.textContent = 'Get it';
      help.addEventListener('click', () => {
        void api.openHelpUrl(helpUrls[id]).catch((error) => showToast(messageFromError(error)));
      });
      row.append(help);
    }
    return row;
  });
  elements.toolsList.replaceChildren(...rows);
  const availablePaths = (capabilities.recipes ?? []).filter((recipe) => recipe.available).length;
  elements.recipeCount.textContent = availablePaths > 0 ? 'Ready' : 'Not ready';
}

function renderState(state) {
  currentState = state;
  const labels = {
    stopped: 'Engine stopped',
    starting: 'Engine starting',
    running: 'Engine ready',
    stopping: 'Engine stopping',
    error: 'Needs attention',
  };
  elements.statusPill.className = `status-pill ${state.state}`;
  elements.statusText.textContent = labels[state.state] ?? 'Engine status unknown';
  elements.engineError.hidden = !state.error;
  elements.engineError.textContent = state.error ?? '';

  if (state.state === 'running') {
    elements.engineTitle.textContent = 'Local conversions are ready';
    elements.engineDescription.textContent = state.previewBuild
      ? `The isolated Preview engine is ready${state.port ? ` on port ${state.port}` : ''}. It cannot change the production Chrome connection.`
      : state.managedByApp
        ? `Chrome can use the private engine on this Mac${state.port ? ` (port ${state.port})` : ''}.`
      : 'A compatible local engine is already running and has been detected.';
    elements.engineButton.textContent = state.managedByApp ? 'Stop engine' : 'Running';
    elements.engineButton.disabled = !state.managedByApp;
  } else if (state.state === 'starting' || state.state === 'stopping') {
    elements.engineTitle.textContent = state.state === 'starting' ? 'Starting the conversion engine…' : 'Stopping safely…';
    elements.engineDescription.textContent = 'This usually takes only a few seconds.';
    elements.engineButton.textContent = state.state === 'starting' ? 'Starting…' : 'Stopping…';
    elements.engineButton.disabled = true;
  } else {
    elements.engineTitle.textContent = state.state === 'error' ? 'The engine needs attention' : 'Local engine is off';
    elements.engineDescription.textContent = 'Start it to convert Office documents, audio and video from Chrome.';
    elements.engineButton.textContent = state.state === 'error' ? 'Try again' : 'Start engine';
    elements.engineButton.disabled = false;
  }
  renderTools(state.capabilities);
}

function renderUpdateState(state) {
  currentUpdateState = state;
  elements.updateVersion.textContent = `Version ${state.currentVersion}`;
  elements.updateMessage.textContent = state.message ?? 'Format Forge can check for updates.';
  elements.updateProgress.hidden = state.state !== 'downloading';
  elements.updateProgressBar.style.width = `${state.progress ?? 0}%`;

  const presentation = {
    disabled: ['Automatic updates unavailable', 'Unavailable', true],
    idle: ['Automatic updates are on', 'Check now', false],
    checking: ['Checking for updates…', 'Checking…', true],
    downloading: ['Downloading the update', `${state.progress ?? 0}%`, true],
    ready: ['An update is ready', 'Restart and install', false],
    current: ['Format Forge is up to date', 'Check again', false],
    installing: ['Installing the update…', 'Restarting…', true],
    error: ['Update check needs attention', 'Try again', false],
  };
  const [title, button, disabled] = presentation[state.state] ?? presentation.error;
  elements.updateTitle.textContent = title;
  elements.updateButton.textContent = button;
  elements.updateButton.disabled = disabled;
}

async function refreshBrowserConnection() {
  try {
    const status = await api.getNativeHostStatus();
    const ready = status.registered && status.executableMatches;
    elements.browserBadge.textContent = ready ? 'Registered' : 'Setup needed';
    elements.browserMessage.textContent = ready
      ? 'Chrome is registered to start and pair with this app automatically.'
      : status.reason ?? 'Register this app with Chrome to enable automatic pairing.';
    elements.registerButton.hidden = ready || status.canRegister === false;
  } catch (error) {
    elements.browserBadge.textContent = 'Unavailable';
    elements.browserMessage.textContent = messageFromError(error);
    elements.registerButton.hidden = false;
  }
}

elements.engineButton.addEventListener('click', async () => {
  elements.engineButton.disabled = true;
  try {
    const next = currentState?.state === 'running' ? await api.stopEngine() : await api.startEngine();
    renderState(next);
  } catch (error) {
    showToast(messageFromError(error));
  }
});

elements.toolRefreshButton.addEventListener('click', async () => {
  elements.toolRefreshButton.disabled = true;
  elements.toolRefreshButton.textContent = 'Checking…';
  try {
    const next = await api.refreshTools();
    renderState(next);
    showToast('Installed tools checked.');
  } catch (error) {
    showToast(messageFromError(error));
  } finally {
    elements.toolRefreshButton.disabled = false;
    elements.toolRefreshButton.textContent = 'Check again';
  }
});

elements.registerButton.addEventListener('click', async () => {
  elements.registerButton.disabled = true;
  try {
    await api.registerNativeHost();
    await refreshBrowserConnection();
    showToast('Chrome connection registered.');
  } catch (error) {
    showToast(messageFromError(error));
  } finally {
    elements.registerButton.disabled = false;
  }
});

elements.revealButton.addEventListener('click', async () => {
  try {
    tokenVisible = !tokenVisible;
    elements.pairingToken.textContent = tokenVisible ? await api.getPairingToken() : '••••••••••••••••••••••••';
    elements.revealButton.textContent = tokenVisible ? 'Hide' : 'Reveal';
  } catch (error) {
    tokenVisible = false;
    showToast(messageFromError(error));
  }
});

elements.copyButton.addEventListener('click', async () => {
  try {
    await api.copyPairingToken();
    showToast('Pairing code copied.');
  } catch (error) {
    showToast(messageFromError(error));
  }
});

elements.loginToggle.addEventListener('change', async () => {
  try {
    elements.loginToggle.checked = await api.setLoginItem(elements.loginToggle.checked);
  } catch (error) {
    elements.loginToggle.checked = !elements.loginToggle.checked;
    showToast(messageFromError(error));
  }
});

elements.updateButton.addEventListener('click', async () => {
  elements.updateButton.disabled = true;
  try {
    const next = currentUpdateState?.state === 'ready'
      ? await api.installUpdate()
      : await api.checkForUpdates();
    renderUpdateState(next);
  } catch (error) {
    showToast(messageFromError(error));
    elements.updateButton.disabled = false;
  }
});

async function initialize() {
  if (!api) {
    elements.engineError.hidden = false;
    elements.engineError.textContent = 'The secure desktop bridge did not load.';
    return;
  }
  api.onState(renderState);
  api.onUpdateState(renderUpdateState);
  const [state, loginEnabled, updateState] = await Promise.all([
    api.getState(),
    api.getLoginItem(),
    api.getUpdateState(),
  ]);
  renderState(state);
  renderUpdateState(updateState);
  elements.loginToggle.checked = loginEnabled;
  await refreshBrowserConnection();
}

void initialize().catch((error) => showToast(messageFromError(error)));
