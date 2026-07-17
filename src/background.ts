const APP_PATH = 'app.html';
const APP_TAB_KEY = 'formatForgeAppTabId';

async function openConverter(): Promise<void> {
  const url = chrome.runtime.getURL(APP_PATH);
  const stored = await chrome.storage.session.get(APP_TAB_KEY);
  const storedTabId = stored[APP_TAB_KEY];

  if (typeof storedTabId === 'number') {
    try {
      const existingTab = await chrome.tabs.get(storedTabId);
      await chrome.tabs.update(storedTabId, { active: true });
      if (existingTab.windowId !== undefined) {
        await chrome.windows.update(existingTab.windowId, { focused: true });
      }
      return;
    } catch {
      await chrome.storage.session.remove(APP_TAB_KEY);
    }
  }

  const createdTab = await chrome.tabs.create({ url });
  if (createdTab.id !== undefined) {
    await chrome.storage.session.set({ [APP_TAB_KEY]: createdTab.id });
  }
}

chrome.action.onClicked.addListener(() => {
  void openConverter();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    void openConverter();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.get(APP_TAB_KEY).then((stored) => {
    if (stored[APP_TAB_KEY] === tabId) {
      return chrome.storage.session.remove(APP_TAB_KEY);
    }
  });
});
