const $ = id => document.getElementById(id);
const SITES = ['lc', 'cf']; // linked, synced in the background; GfG only pushes live from the page
const FIELDS = [...SITES, 'gfg'].map(p => `${p}Repo`); // the token is saved once on the setup step, never shown again

// A background worker still running older code drops unknown messages, so sendMessage resolves undefined.
const ask = async msg => (await chrome.runtime.sendMessage(msg)) || { error: 'CodeSync was updated; reload it in chrome://extensions' };

function showStatus(el, text) {
  el.textContent = text || '';
  el.className = 'status' + (/^Error/.test(text) ? ' err' : text ? ' ok' : '');
}

async function render() {
  const s = await chrome.storage.local.get(['token', ...FIELDS, ...SITES.flatMap(p => [`${p}Status`, `${p}LastTs`, `${p}User`]), 'gfgStatus']);
  $('setup').hidden = !!s.token;
  $('main').hidden = !s.token;
  showStatus($('gfgStatus'), s.gfgStatus);
  for (const f of FIELDS) if (document.activeElement !== $(f)) $(f).value = s[f] || '';
  for (const p of SITES) {
    const user = s[`${p}User`], link = $(`${p}Link`);
    showStatus($(`${p}Status`), s[`${p}Status`]);
    $(`${p}Hint`).textContent = !user ? '' : p === 'cf'
      ? `Linked as ${user} · syncs every 15 min; briefly opens a background tab per new solve.`
      : `Linked as ${user} · syncs every 15 min, no tab needed.`;
    if (link.getAttribute('aria-busy') !== 'true') link.querySelector('span').textContent = user ? 'Relink' : 'Link account';
    link.classList.toggle('tinted', !user);
    link.classList.toggle('secondary', !!user);
    // Full-history pass: the cursor stays empty until it completes; an error or "Up to date" ends it.
    // toggleAttribute, not .hidden: SVG elements have no hidden property, so assigning it does nothing.
    $(`${p}Spinner`).toggleAttribute('hidden', !(!s[`${p}LastTs`] && /^(Re-sync queued|Syncing)/.test(s[`${p}Status`])));
  }
}

async function save() {
  const v = Object.fromEntries(FIELDS.map(f => [f, $(f).value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '')]));
  const { token } = await chrome.storage.local.get('token');
  for (const key of FIELDS) {
    if (!v[key]) continue;
    const r = await ask({ type: 'checkRepo', token, repo: v[key] });
    if (r.error) return showStatus($('saveStatus'), `Error: ${v[key]}: ${r.error}`);
  }
  await chrome.storage.local.set(v);
  showStatus($('saveStatus'), 'Saved');
}

$('setup').onsubmit = async e => {
  e.preventDefault();
  const token = $('token').value.trim();
  $('saveToken').disabled = true;
  showStatus($('tokenStatus'), '');
  $('tokenStatus').textContent = 'Checking token…';
  try {
    const r = await ask({ type: 'checkToken', token });
    if (r.error) throw new Error(r.error);
    $('token').value = '';
    await chrome.storage.local.set({ token });
    $('tokenStatus').textContent = '';
    await render(); // swap to the repos step now so focus lands on a visible field
    $('lcRepo').focus();
  } catch (e) { showStatus($('tokenStatus'), `Error: ${e.message}`); }
  $('saveToken').disabled = false;
};

$('save').onclick = async () => {
  $('save').disabled = true;
  $('saveStatus').textContent = 'Checking repos…';
  $('saveStatus').className = 'status';
  try { await save(); } catch (e) { showStatus($('saveStatus'), `Error: ${e.message}`); }
  $('save').disabled = false;
};

// Forgets everything CodeSync stored: GitHub token, repos, linked accounts, sync cursors and statuses.
// ponytail: a sync already mid-pass may still write its status and cursor when it ends; reset after it
// finishes (or use Re-sync after relinking) if that matters.
$('reset').onclick = async () => {
  if (!confirm('Forget the GitHub token, repos and linked accounts?')) return;
  await chrome.storage.local.clear();
  for (const f of FIELDS) $(f).value = '';
  showStatus($('saveStatus'), '');
  await render();
  $('token').focus();
};

for (const p of SITES) {
  $(`${p}Link`).onclick = async () => {
    const b = $(`${p}Link`);
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    b.querySelector('span').textContent = 'Linking…';
    const r = await ask({ type: 'link', p });
    if (r.error) await chrome.storage.local.set({ [`${p}Status`]: `Error: ${r.error}` }); // stored, so render() keeps it
    b.disabled = false;
    b.removeAttribute('aria-busy');
    render();
  };
  $(`${p}Resync`).onclick = async () => {
    await chrome.storage.local.set({ [`${p}LastTs`]: 0, [`${p}Status`]: 'Re-sync queued…' });
    chrome.runtime.sendMessage({ type: 'resync', p });
  };
}

const systemDark = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => (document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light')) === 'dark';

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  $('moon').toggleAttribute('hidden', isDark());
  $('sun').toggleAttribute('hidden', !isDark());
  $('theme').setAttribute('aria-label', `Switch to ${isDark() ? 'light' : 'dark'} mode`);
}

$('theme').onclick = () => {
  const theme = isDark() ? 'light' : 'dark';
  try { localStorage.theme = theme; } catch {}
  applyTheme(theme);
};
systemDark.onchange = () => applyTheme();
try { applyTheme(localStorage.theme); } catch { applyTheme(); }

chrome.storage.onChanged.addListener(render);
render().then(() => requestAnimationFrame(() => document.documentElement.classList.add('ready')));
