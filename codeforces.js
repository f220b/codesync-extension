// The sync runs in background.js; this just nudges it after a Submit, which lands on a "my submissions"
// page (/contest/<id>/my or /problemset/status?my=on). It polls the user's latest submission until it
// has a final verdict; after 30s it syncs anyway, and the next nudge or timer tick catches a slower one.
if (/\/my\b/.test(location.pathname) || /\bmy=on\b/.test(location.search)) {
  (async () => {
    const { cfUser } = await chrome.storage.local.get('cfUser');
    if (!cfUser) return;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const j = await fetch(`/api/user.status?handle=${encodeURIComponent(cfUser)}&count=1`).then(r => r.json()).catch(() => ({}));
      const v = j.result?.[0]?.verdict;
      if (v && v !== 'TESTING') break;
    }
    chrome.runtime.sendMessage({ type: 'sync', p: 'cf' });
  })();
}
