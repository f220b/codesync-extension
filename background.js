importScripts('lib.js');

// Serialize commits: parallel PUTs to one repo race on the branch head and fail with 409.
let queue = Promise.resolve();
function serial(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gh(token, method, path, body) {
  for (let wait = 1000; ; wait *= 2) {
    const r = await fetch(`https://api.github.com${path}`, {
      method,
      cache: 'no-store', // GitHub caches GETs ~60s; a stale sha makes the next PUT fail
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      body: body && JSON.stringify(body),
    });
    // GitHub 5xx are usually transient, and one would otherwise fail a whole history backfill.
    // Retrying is safe: tree/commit POSTs only create unreferenced objects, the ref PATCH is idempotent.
    if (r.status >= 500 && wait <= 8000) { await sleep(wait); continue; }
    if (r.status === 404 && method === 'GET') return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.json().catch(() => ({}))).message || r.statusText || `${method} ${path.split('?')[0]}`}`);
    return r.json();
  }
}

async function push({ platform, path, content, message }) {
  const s = await chrome.storage.local.get(['token', `${platform}Repo`]);
  const repo = s[`${platform}Repo`];
  if (!s.token || !repo) throw new Error('Set a GitHub token and repo in CodeSync settings');
  const url = `/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const data = b64(content);
  const existing = await gh(s.token, 'GET', url);
  if (existing && existing.content.replace(/\n/g, '') === data) return; // unchanged, no empty commit
  await gh(s.token, 'PUT', url, { message, content: data, sha: existing?.sha });
}

// Background passes commit through the Git Data API: one tree read up front tells which files already
// match (by blob sha, no GET per file), and changed files go out as one commit per batch, not one each.
async function gitBatch(platform) {
  const s = await chrome.storage.local.get(['token', `${platform}Repo`]);
  const repo = s[`${platform}Repo`];
  if (!s.token || !repo) throw new Error('Set a GitHub token and repo in CodeSync settings');
  const api = (method, path, body) => gh(s.token, method, `/repos/${repo}${path}`, body);
  let branch;
  // An empty repo answers 409 and has no ref yet.
  const head = () => api('GET', `/git/ref/heads/${branch}`).catch(e => { if (e.message.startsWith('GitHub 409')) return null; throw e; });

  // Loaded on first use, so a pass with nothing new costs no GitHub calls.
  const files = new Map(); // path -> blob sha
  let loaded;
  const load = () => loaded ||= (async () => {
    branch = (await api('GET', '')).default_branch;
    const ref = await head();
    // ponytail: a truncated tree (100k+ entries) only means some unchanged files get recommitted as no-ops.
    if (ref) for (const e of (await api('GET', `/git/trees/${ref.object.sha}?recursive=1`)).tree) if (e.type === 'blob') files.set(e.path, e.sha);
  })();

  let pending = [];
  const flush = () => {
    const batch = pending;
    pending = [];
    // serial: live pushes also move the branch, so re-read the head right before committing on top of it.
    return batch.length && serial(async () => {
      let ref = await head();
      if (!ref) { // the Git Data API can't write to an empty repo; the first file makes its first commit
        await push({ platform, ...batch.shift() });
        if (!batch.length) return;
        ref = await head();
      }
      const parent = await api('GET', `/git/commits/${ref.object.sha}`);
      const tree = await api('POST', '/git/trees', {
        base_tree: parent.tree.sha,
        tree: batch.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
      });
      const message = batch.length === 1 ? batch[0].message
        : `Sync ${batch.length} files\n\n${batch.map(f => f.message.split('\n')[0]).join('\n')}`;
      const commit = await api('POST', '/git/commits', { message, tree: tree.sha, parents: [ref.object.sha] });
      await api('PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha });
    });
  };

  return {
    async paths() { await load(); return [...files.keys()]; },
    // Queues the file if it differs from the repo; true when it will be committed.
    async add(path, content, message) {
      await load();
      const sha = await gitBlobSha(content);
      if (files.get(path) === sha) return false;
      files.set(path, sha);
      pending.push({ path, content, message });
      if (pending.length >= 40) await flush(); // a failed long backfill keeps what it already committed
      return true;
    },
    flush,
  };
}

// Syncs run here, not in a tab: host_permissions make these fetches carry the browser's session cookies.
async function getJson(url, site, opt) {
  for (let wait = 2000; ; wait *= 2) {
    // A hung request would hold run.running forever now that the keepalive stops Chrome killing the worker.
    const r = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(60000), ...opt });
    // LeetCode answers 403 (not 429) when a long walk pages too fast; logged out is 401 or a redirect.
    if ((r.status === 429 || r.status === 403) && wait <= 64000) { await sleep(wait); continue; }
    if (r.status === 401 || r.redirected) throw new Error(`not logged in to ${site}`);
    if (!r.ok) throw new Error(`${site} ${r.status} on ${new URL(url).pathname}`);
    return r.json();
  }
}

// LeetCode: one incremental pass handles both history (lcLastTs = 0, walks every submission)
// and new solves (only newer than lcLastTs).
async function lcPass(run) {
  const { lcRepo, lcLastTs = 0 } = await chrome.storage.local.get(['lcRepo', 'lcLastTs']);
  if (!lcRepo) return;
  const seen = new Set(), repo = await gitBatch('lc');
  let newest = lcLastTs, offset = 0, lastKey = '', pushed = 0;
  for (;;) {
    // Most files are usually unchanged (no push), so report progress per page, not per push.
    await chrome.storage.local.set({ lcStatus: `Syncing… ${offset} submissions checked · ${pushed} pushed` });
    const page = await getJson(`https://leetcode.com/api/submissions/?offset=${offset}&limit=20&lastkey=${lastKey}`, 'LeetCode');
    const subs = page.submissions_dump || [];
    for (const s of newAccepted(subs, lcLastTs, seen)) {
      const link = `https://leetcode.com/problems/${s.title_slug}/`;
      // A README already in the repo gives the folder; otherwise one GraphQL call has the number and statement.
      const name = lcFolder(undefined, s.title);
      const readme = (await repo.paths()).find(p => p === `${name}/README.md` || p.endsWith(`. ${name}/README.md`));
      let dir = readme?.slice(0, -'/README.md'.length);
      if (!dir) {
        const q = await lcQuestion(s.title_slug);
        dir = lcFolder(q.questionFrontendId, s.title);
        await repo.add(`${dir}/README.md`, lcReadme(q, s.title_slug), `${s.title} (problem)\n\n${link}`);
      }
      pushed += await repo.add(`${dir}/solution.${extFor(s.lang)}`, s.code, `${s.title} (${s.lang})\n\n${link}`);
    }
    await repo.flush();
    if (subs.length) newest = Math.max(newest, subs[0].timestamp);
    if (!page.has_next || subs.some(s => s.timestamp <= lcLastTs)) break;
    offset += 20;
    lastKey = page.last_key || '';
    await sleep(1000); // stay under LeetCode's rate limit during a full backfill
  }
  // Only advance after a complete pass; a failed backfill restarts and skips unchanged files.
  // A re-sync clicked mid-run must not be overwritten by this run's cursor.
  if (!run.again) await chrome.storage.local.set({ lcLastTs: newest, lcStatus: `Up to date · ${pushed} pushed · ${new Date().toLocaleString()}` });
}

// LeetCode rejects worker requests as cross-site (Origin chrome-extension://…, no Referer): 403 when
// logged in, which read as "not logged in". Make them look like the site's own requests.
chrome.declarativeNetRequest.updateSessionRules({
  removeRuleIds: [1],
  addRules: [{
    id: 1,
    condition: { requestDomains: ['leetcode.com'], initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest'] },
    action: { type: 'modifyHeaders', requestHeaders: [
      { header: 'Origin', operation: 'set', value: 'https://leetcode.com' },
      { header: 'Referer', operation: 'set', value: 'https://leetcode.com/' },
    ] },
  }],
});

// Django's CSRF check on authenticated GraphQL POSTs wants the csrftoken cookie echoed in a header.
async function lcPost(body) {
  const c = await chrome.cookies.get({ url: 'https://leetcode.com', name: 'csrftoken' });
  return getJson('https://leetcode.com/graphql', 'LeetCode', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrftoken': c?.value || '' }, body: JSON.stringify(body),
  });
}

async function lcQuestion(slug) {
  const j = await lcPost({
    query: 'query($s: String!) { question(titleSlug: $s) { questionFrontendId title difficulty content topicTags { name } } }',
    variables: { s: slug },
  });
  return j.data.question;
}

// "Link": confirm the browser's leetcode.com session and remember whose it is.
async function lcLink() {
  const { data } = await lcPost({ query: '{ userStatus { username isSignedIn } }' });
  if (!data.userStatus.isSignedIn) throw new Error('log in to leetcode.com in this browser first');
  return data.userStatus.username;
}

// Codeforces pages sit behind a Cloudflare check a background fetch can't pass (its API doesn't), so pages
// are read from a real background tab, polled until `read` returns non-null. Pass `tab` to reuse one
// across reads (it's navigated, not recreated); otherwise a tab is opened and closed for this read.
async function readTab(url, read, tab) {
  const own = !tab;
  if (own) tab = await chrome.tabs.create({ url, active: false });
  else await chrome.tabs.update(tab.id, { url });
  try {
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      // update() returns before the previous page unloads; don't read it.
      const t = await chrome.tabs.get(tab.id);
      if (t.status !== 'complete' || t.url !== url) continue;
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: read }).catch(() => []); // throws mid-navigation
      if (r?.result != null) return r.result;
    }
    return null;
  } finally {
    if (own) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// Codeforces: the public API lists every submission (no code); each new accepted one's code is read
// from its submission page. Same cursor scheme as LeetCode: cfLastTs = 0 walks the full history.
async function cfPass(run) {
  const { cfRepo, cfUser, cfLastTs = 0 } = await chrome.storage.local.get(['cfRepo', 'cfUser', 'cfLastTs']);
  if (!cfRepo || !cfUser) return;
  const { result } = await getJson(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(cfUser)}`, 'Codeforces');
  const subs = result.filter(s => s.problem.contestId).map(s => ({ // contest-less (acmsguru) problems have no submission page
    ...s, timestamp: s.creationTimeSeconds, status_display: s.verdict === 'OK' ? 'Accepted' : s.verdict,
    title_slug: `${s.problem.contestId}${s.problem.index}`,
  }));
  const todo = newAccepted(subs, cfLastTs, new Set()), repo = await gitBatch('cf');
  let pushed = 0, tab;
  try {
    for (const [i, s] of todo.entries()) {
      await chrome.storage.local.set({ cfStatus: `Syncing… ${i} of ${todo.length} problems checked · ${pushed} pushed` });
      const { contestId: c, index, name } = s.problem;
      const base = `https://codeforces.com/${c >= 100000 ? 'gym' : 'contest'}/${c}`;
      tab ||= await chrome.tabs.create({ url: 'about:blank', active: false });
      // innerText, not textContent: prettify splits the code into <li> lines with no newlines between them.
      const code = await readTab(`${base}/submission/${s.id}`, () => document.getElementById('program-source-text')?.innerText, tab);
      if (!code) throw new Error(`could not read submission ${s.id}; log in to codeforces.com in this browser`);
      pushed += await repo.add(
        `${lcFolder(s.title_slug, name)}/solution.${cfExt(s.programmingLanguage)}`, // "2261H. Name"
        code,
        `${name} (${s.programmingLanguage})\n\n${base}/problem/${index}`);
      await sleep(2000); // Codeforces throttles rapid page loads
    }
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
  await repo.flush();
  // A submission still being judged must stay ahead of the cursor, or its verdict is never picked up.
  const judging = subs.filter(s => !s.verdict || s.verdict === 'TESTING').map(s => s.timestamp);
  const cursor = judging.length ? Math.min(...judging) - 1 : subs[0]?.timestamp || 0;
  if (!run.again) await chrome.storage.local.set({ cfLastTs: Math.max(cfLastTs, cursor), cfStatus: `Up to date · ${pushed} pushed · ${new Date().toLocaleString()}` });
}

// The header shows "<handle> | Logout" when logged in, "Enter | Register" when not.
async function cfLink() {
  const user = await readTab('https://codeforces.com/', () =>
    document.querySelector('.lang-chooser') && (document.querySelector('.lang-chooser a[href^="/profile/"]')?.textContent.trim() || ''));
  if (user == null) throw new Error('codeforces.com did not load');
  if (!user) throw new Error('log in to codeforces.com in this browser first');
  return user;
}

const SITES = { lc: { pass: lcPass, link: lcLink }, cf: { pass: cfPass, link: cfLink } };
const runs = {}; // per site: { running, again: re-sync clicked mid-pass }

// Chrome stops an extension worker after 30s without an extension API call; a 32s+ 429 backoff or a slow
// fetch hit that and froze the pass at "Syncing…" until a page load or the timer restarted it. Any API call
// resets the idle timer, so one every 20s keeps the worker alive until the pass ends.
// ponytail: if Chrome still stops the worker (browser quit, update), the cursor stays unset and the next
// trigger restarts the pass, skipping unchanged files.
function sync(p) {
  const run = runs[p] ||= {};
  if (run.running) return;
  run.running = true; // set before any await, or two triggers both start a pass
  const keepalive = setInterval(chrome.runtime.getPlatformInfo, 20000);
  SITES[p].pass(run)
    .catch(e => chrome.storage.local.set({ [`${p}Status`]: `Error: ${e.message}` }))
    .finally(() => { clearInterval(keepalive); run.running = false; if (run.again) { run.again = false; sync(p); } });
}

async function link(p) {
  const user = await SITES[p].link();
  await chrome.storage.local.set({ [`${p}User`]: user });
  sync(p);
  return { user };
}

// Linked accounts sync on a timer, no tab needed. get-before-create so worker restarts don't reset it.
chrome.alarms.clear('lcSync'); // pre-GfG alarm name
// GfG history sync was removed (live push only); drop its state once, including the stale link error.
chrome.storage.local.get('gfgUser').then(s => s.gfgUser && chrome.storage.local.remove(['gfgUser', 'gfgLastTs', 'gfgStatus']));
chrome.alarms.get('sync').then(a => a || chrome.alarms.create('sync', { periodInMinutes: 15 }));
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== 'sync') return;
  const s = await chrome.storage.local.get(Object.keys(SITES).map(p => `${p}User`));
  for (const p in SITES) if (s[`${p}User`]) sync(p);
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'push') {
    serial(() => push(msg)).then(() => reply({}), e => reply({ error: e.message }));
  } else if (msg.type === 'sync') {
    return void sync(msg.p);
  } else if (msg.type === 'resync') {
    return void (runs[msg.p]?.running ? (runs[msg.p].again = true) : sync(msg.p));
  } else if (msg.type === 'link') {
    link(msg.p).then(reply, e => reply({ error: e.message }));
  } else if (msg.type === 'checkToken') {
    gh(msg.token, 'GET', '/user').then(() => reply({}), e => reply({ error: e.message }));
  } else if (msg.type === 'checkRepo') {
    gh(msg.token, 'GET', `/repos/${msg.repo}`)
      .then(r => reply(r ? (r.permissions?.push ? {} : { error: 'token has no write access' }) : { error: 'repo not found' }),
            e => reply({ error: e.message }));
  } else if (msg.type === 'gfgCode') {
    // GfG's editor object lives in the page's JS world, which content scripts can't see.
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => {
        const el = document.querySelector('.ace_editor');
        if (!el || !window.ace) return null;
        const ed = window.ace.edit(el);
        return { code: ed.getValue(), mode: ed.session.getMode().$id };
      },
    }).then(([r]) => reply(r.result || { error: 'editor not found' }), e => reply({ error: e.message }));
  } else return;
  return true; // reply is async
});
