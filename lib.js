// Shared by content scripts, background (importScripts) and test_lib.js.
const EXT = {
  cpp: 'cpp', c_cpp: 'cpp', c: 'c', java: 'java', python: 'py', python3: 'py', pythondata: 'py',
  csharp: 'cs', javascript: 'js', typescript: 'ts', php: 'php', swift: 'swift', kotlin: 'kt',
  golang: 'go', ruby: 'rb', scala: 'scala', rust: 'rs', dart: 'dart', racket: 'rkt',
  erlang: 'erl', elixir: 'ex', bash: 'sh', mysql: 'sql', mssql: 'sql', oraclesql: 'sql', postgresql: 'sql',
};
function extFor(lang) { return EXT[lang] || 'txt'; }

// Codeforces names languages by compiler ("C++23 (GCC 14-64)", "PyPy 3-64", "GNU C11"); first match
// wins, so C++/C# precede C and JavaScript precedes Java.
const CF_EXT = [
  [/c\+\+|clang/i, 'cpp'], [/c#|mono/i, 'cs'], [/^(gnu )?c\d*\b/i, 'c'], [/javascript|node/i, 'js'],
  [/java/i, 'java'], [/kotlin/i, 'kt'], [/python|pypy/i, 'py'], [/\bgo\b/i, 'go'], [/rust/i, 'rs'],
  [/ruby/i, 'rb'], [/haskell/i, 'hs'], [/scala/i, 'scala'], [/php/i, 'php'], [/perl/i, 'pl'],
  [/pascal|delphi/i, 'pas'], [/ocaml/i, 'ml'],
];
function cfExt(lang) { return (CF_EXT.find(([re]) => re.test(lang)) || [, 'txt'])[1]; }

// Submissions arrive newest first. Returns the newest accepted one per problem newer than lastTs;
// `seen` carries across pages so an older accepted copy never overwrites a newer one.
function newAccepted(subs, lastTs, seen) {
  const out = [];
  for (const s of subs) {
    if (s.timestamp <= lastTs || s.status_display !== 'Accepted' || seen.has(s.title_slug)) continue;
    seen.add(s.title_slug);
    out.push(s);
  }
  return out;
}

// LeetCode folder name as shown on the site: "3551. Minimum Swaps to Sort by Digit Sum".
// "/" would nest a folder, so it becomes "-"; an unknown number falls back to the bare title.
function lcFolder(num, title) {
  const name = title.replace(/\//g, '-');
  return num ? `${num}. ${name}` : name;
}

// Problem README in GfG-To-GitHub's shape: linked title, difficulty, statement HTML, topic tags.
// Premium problems come back with null content unless the session has premium.
function lcReadme(q, slug) {
  const tags = q.topicTags.map(t => `<code>${t.name}</code>`).join(' ');
  return `<h2><a href="https://leetcode.com/problems/${slug}/">${lcFolder(q.questionFrontendId, q.title)}</a></h2>` +
    `<h3>Difficulty: ${q.difficulty}</h3><hr>${q.content || '<p>Statement unavailable (premium problem).</p>'}` +
    (tags ? `<p><strong>Topic Tags:</strong><br>${tags}</p>` : '') + '\n';
}

// GitHub's blob id: SHA-1 of "blob <byte length>\0<bytes>". Matching it against the repo tree spots
// unchanged files without fetching them.
async function gitBlobSha(str) {
  const body = new TextEncoder().encode(str);
  const head = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(head.length + body.length);
  buf.set(head);
  buf.set(body, head.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
}

// UTF-8 safe base64 for the GitHub contents API.
function b64(str) {
  let bin = '';
  for (const byte of new TextEncoder().encode(str)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

if (typeof module !== 'undefined') module.exports = { extFor, cfExt, newAccepted, lcFolder, lcReadme, gitBlobSha, b64 };
