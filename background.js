// Sidebar Notes+ - Background Service Worker

const setupSidePanel = () => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
};

chrome.runtime.onInstalled.addListener(setupSidePanel);
chrome.runtime.onStartup.addListener(setupSidePanel);

// Since we removed all content scripts for screenshot/draw/color picker
// we no longer have message forwarding here.
