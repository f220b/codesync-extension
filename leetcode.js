// The sync itself runs in background.js (no tab needed); this tab just nudges it on page load
// and once a Submit is judged, so new solves land without waiting for the timer.
const sync = () => chrome.runtime.sendMessage({ type: 'sync', p: 'lc' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Polls the endpoint LeetCode's own page uses for the verdict; after 30s syncs anyway and lets the
// next page load or timer tick catch a slower verdict.
async function syncWhenJudged(id) {
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const r = await fetch(`/submissions/detail/${id}/check/`).then(r => r.json()).catch(() => ({}));
    if (r.state === 'SUCCESS') break;
  }
  sync();
}

// After Submit, LeetCode navigates to /problems/<slug>/submissions/<id>/.
let lastUrl = location.href;
setInterval(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  const id = location.pathname.match(/\/submissions\/(\d+)/)?.[1];
  if (id) syncWhenJudged(id);
}, 1000);

sync();
