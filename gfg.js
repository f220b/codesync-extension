// Runs on GfG problem pages. When the success banner appears, reads the editor and pushes it.
// ponytail: detects success by banner text, polled every 2s; switch to watching the submit
// request if GfG changes the wording.
const SUCCESS = 'Problem Solved Successfully';
let solved = false;

async function pushSolution() {
  const { gfgRepo } = await chrome.storage.local.get('gfgRepo');
  if (!gfgRepo) return;
  const ed = await chrome.runtime.sendMessage({ type: 'gfgCode' });
  if (ed.error) return chrome.storage.local.set({ gfgStatus: `Error: ${ed.error}` });
  const slug = location.pathname.split('/')[2]; // /problems/<slug>/1
  const lang = ed.mode.split('/').pop();        // ace/mode/c_cpp -> c_cpp
  const res = await chrome.runtime.sendMessage({
    type: 'push', platform: 'gfg',
    path: `${slug}/solution.${extFor(lang)}`,
    content: ed.code,
    message: `${document.title} (${lang})\n\n${location.origin}/problems/${slug}/1`,
  });
  await chrome.storage.local.set({ gfgStatus: res.error ? `Error: ${res.error}` : `Pushed ${slug} · ${new Date().toLocaleString()}` });
}

setInterval(() => {
  const now = document.body.textContent.includes(SUCCESS);
  if (now && !solved) pushSolution();
  solved = now;
}, 2000);
