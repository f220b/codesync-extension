// node test_lib.js
const assert = require('assert');
const { extFor, cfExt, newAccepted, lcFolder, lcReadme, gitBlobSha, b64 } = require('./lib.js');

assert.strictEqual(extFor('python3'), 'py');
assert.strictEqual(extFor('c_cpp'), 'cpp');
assert.strictEqual(extFor('cobol'), 'txt');

for (const [lang, ext] of [['C++23 (GCC 14-64, msys2)', 'cpp'], ['GNU C++17', 'cpp'], ['GNU C11', 'c'], ['C# 10', 'cs'],
  ['JavaScript V8 4.8.0', 'js'], ['Node.js 15.8.0 (64bit)', 'js'], ['Java 21 64bit', 'java'], ['PyPy 3-64', 'py'],
  ['Python 3', 'py'], ['Go 1.22.2', 'go'], ['Rust 2021', 'rs'], ['Kotlin 1.9', 'kt'], ['Befunge', 'txt']]) {
  assert.strictEqual(cfExt(lang), ext, lang);
}

const sub = (slug, ts, status = 'Accepted') => ({ title_slug: slug, timestamp: ts, status_display: status });
const seen = new Set();
const page1 = [sub('two-sum', 50), sub('lru', 40, 'Wrong Answer'), sub('two-sum', 30), sub('lru', 20)];
assert.deepStrictEqual(newAccepted(page1, 0, seen).map(s => [s.title_slug, s.timestamp]), [['two-sum', 50], ['lru', 20]]);
assert.deepStrictEqual(newAccepted([sub('two-sum', 10)], 0, seen), []); // older copy on a later page
assert.deepStrictEqual(newAccepted([sub('a', 5), sub('b', 15)], 10, new Set()).map(s => s.title_slug), ['b']);

assert.strictEqual(lcFolder(3551, 'Minimum Swaps to Sort by Digit Sum'), '3551. Minimum Swaps to Sort by Digit Sum');
assert.strictEqual(lcFolder(1, 'A/B Testing'), '1. A-B Testing');
assert.strictEqual(lcFolder(undefined, 'Two Sum'), 'Two Sum');

const q = { questionFrontendId: '1', title: 'Two Sum', difficulty: 'Easy', content: '<p>stmt</p>', topicTags: [{ name: 'Array' }] };
const md = lcReadme(q, 'two-sum');
for (const part of ['<a href="https://leetcode.com/problems/two-sum/">1. Two Sum</a>', 'Difficulty: Easy', '<p>stmt</p>', '<code>Array</code>']) assert(md.includes(part), part);
assert(lcReadme({ ...q, content: null, topicTags: [] }, 'two-sum').includes('premium'));

assert.strictEqual(Buffer.from(b64('héllo ✓'), 'base64').toString(), 'héllo ✓');
(async () => {
  assert.strictEqual(await gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a'); // git hash-object
  assert.strictEqual(await gitBlobSha('é\n'), require('child_process').execSync('git hash-object --stdin', { input: 'é\n' }).toString().trim());
  console.log('ok');
})();
