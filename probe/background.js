// Keeps the latest report of each frame, per tab, in session storage.
// Writes are chained so reports from several frames don't overwrite each other.
let queue = Promise.resolve();

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'probe_report' || !sender.tab) return;
  const key = `tab_${sender.tab.id}`;
  queue = queue.then(async () => {
    const data = await chrome.storage.session.get(key);
    const frames = data[key] || {};
    frames[sender.frameId] = { ...msg.report, frameId: sender.frameId, at: new Date().toLocaleTimeString() };
    await chrome.storage.session.set({ [key]: frames });
  });
});

chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove(`tab_${tabId}`));

// A new page in the tab: drop the old page's reports.
chrome.webNavigation.onCommitted.addListener(({ tabId, frameId }) => {
  if (frameId === 0) chrome.storage.session.remove(`tab_${tabId}`);
});
