// 判定エンジンの動作確認。Node 18 以上の標準テストランナーで動く: npm test
const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');
const D = require('../src/demo.js');

const cfg = { product: D.product, terms: D.terms, rules: { apologyLimit: 2 } };

test('OK例の通話は合格になる', () => {
  const res = E.analyze(D.calls.ok, cfg);
  const sc = E.score(res, {}, 6);
  assert.strictEqual(sc.verdict, 'pass');
  assert.strictEqual(res.checks.email.state, 'ok');
  assert.strictEqual(res.checks.appo.state, 'ok');
});

test('NG例の通話は二重敬語と謝罪過多を拾う', () => {
  const res = E.analyze(D.calls.ng, cfg);
  assert.ok(res.checks.keigo.ng >= 1, '二重敬語を検出する');
  assert.strictEqual(res.checks.apology.state, 'ng');
  assert.notStrictEqual(E.score(res, {}, 6).verdict, 'pass');
});

test('クレーム例はイレギュラー扱いで、短く切れていればOK', () => {
  const res = E.analyze(D.calls.claim, cfg);
  assert.strictEqual(res.irregular.on, true);
  assert.strictEqual(res.irregular.ok, true);
});

test('漢数字と「千」を数字にそろえる', () => {
  assert.strictEqual(E.numNorm('三千社'), '3000社');
  assert.strictEqual(E.numNorm('3千社'), '3000社');
});

test('辞書で誤認識を正式な用語に読み替える', () => {
  const res = E.analyze('営業: アイブイアールで自動化します', cfg);
  assert.ok(res.dictFixes.some(f => f.to === 'IVR'));
});
