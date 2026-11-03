/* 判定エンジン：DOMに触らない純粋関数だけ。Nodeでもそのまま動く。 */
var TMEngine = (function () {
  'use strict';

  var KD = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  function kanjiToNum(s) {
    var total = 0, sec = 0, cur = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch in KD) cur = cur * 10 + KD[ch];
      else if (ch === '十') { sec += (cur || 1) * 10; cur = 0; }
      else if (ch === '百') { sec += (cur || 1) * 100; cur = 0; }
      else if (ch === '千') { sec += (cur || 1) * 1000; cur = 0; }
      else if (ch === '万') { total += ((sec + cur) || 1) * 1e4; sec = 0; cur = 0; }
      else if (ch === '億') { total += ((sec + cur) || 1) * 1e8; sec = 0; cur = 0; }
    }
    return total + sec + cur;
  }

  function norm(t) {
    return String(t == null ? '' : t).normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[ \t　]+/g, ' ');
  }

  var K_UNIT = '(?:パーセント|か月|ヶ月|カ月|ケ月|店舗|拠点|月|日|時|社|件|円|割|倍|名|人|年|%)';
  var K_RE = new RegExp('([〇一二三四五六七八九十百千万億]+)(?=' + K_UNIT + ')', 'g');
  /* 漢数字・「3千」「3万」・桁区切りカンマをアラビア数字にそろえる */
  function numNorm(t) {
    t = t.replace(/(\d),(?=\d{3})/g, '$1');
    t = t.replace(K_RE, function (m, k, off, str) {
      var prev = str[off - 1] || '';
      if (prev === '数' || prev === '何' || /\d/.test(prev)) return m;
      if (m === '万' || m === '億') return m;
      var after = str.slice(off + m.length, off + m.length + 2);
      if (m === '一' && /^(時的|時期|人一|日中)/.test(after)) return m;
      return String(kanjiToNum(m));
    });
    for (var i = 0; i < 2; i++) {
      t = t.replace(/(\d+(?:\.\d+)?)\s*(千|万|億)/g, function (m, n, u) {
        return String(Math.round(parseFloat(n) * ({ '千': 1e3, '万': 1e4, '億': 1e8 })[u]));
      });
    }
    return t;
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function list(v) {
    if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
    return String(v || '').split(/[,、\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* 辞書：誤認識・表記ゆれを正式な用語に置き換える（1パスなので二重置換しない） */
  function applyDict(text, terms) {
    var map = {}, keys = [];
    (terms || []).forEach(function (t) {
      var term = norm(t.term).trim();
      if (!term) return;
      map[term.toLowerCase()] = null; keys.push(term);
      list(t.variants).forEach(function (v) {
        v = norm(v).trim();
        if (!v || v.toLowerCase() === term.toLowerCase()) return;
        if (map[v.toLowerCase()] === undefined) { map[v.toLowerCase()] = term; keys.push(v); }
      });
    });
    if (!keys.length) return { text: text, fixes: [] };
    keys.sort(function (a, b) { return b.length - a.length; });
    var re = new RegExp(keys.map(escRe).join('|'), 'gi');
    var fixes = {};
    var out = text.replace(re, function (m) {
      var to = map[m.toLowerCase()];
      if (!to) return m;
      var k = m + '→' + to;
      fixes[k] = fixes[k] || { from: m, to: to, count: 0 };
      fixes[k].count++;
      return to;
    });
    return { text: out, fixes: Object.keys(fixes).map(function (k) { return fixes[k]; }) };
  }

  var SP_RE = /^\s*(?:[\[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*)?([^\s:「」。、,.]{1,14}?)\s*:\s*(.*)$/;
  function parseSpeakers(text) {
    var lines = text.split('\n'), counts = {}, n = 0;
    lines.forEach(function (ln) {
      var m = SP_RE.exec(ln);
      if (m && !/^\d+$/.test(m[1])) { counts[m[1]] = (counts[m[1]] || 0) + 1; n++; }
    });
    var labels = Object.keys(counts);
    if (labels.length < 2 || labels.length > 4 || n < 2) {
      return { labels: [], turns: [{ sp: null, text: text.trim() }] };
    }
    var turns = [];
    lines.forEach(function (ln) {
      var m = SP_RE.exec(ln);
      if (m && counts[m[1]]) turns.push({ sp: m[1], text: m[2].trim() });
      else if (ln.trim()) {
        if (turns.length) turns[turns.length - 1].text += '\n' + ln.trim();
        else turns.push({ sp: labels[0], text: ln.trim() });
      }
    });
    return { labels: labels, turns: turns };
  }

  function guessAgent(parsed) {
    if (!parsed.labels.length) return null;
    var best = null, bestScore = -1;
    parsed.labels.forEach(function (lb) {
      var txt = parsed.turns.filter(function (t) { return t.sp === lb; }).map(function (t) { return t.text; }).join('');
      var s = 0;
      if (/と申します|お電話(?:いた|致)しました|お電話差し上げ/.test(txt)) s += 3;
      if (/自分|IS|営業|オペ|架電|当社|弊社|インサイド|agent|caller|sales|担当/i.test(lb)) s += 2;
      s += Math.min(txt.length / 1000, 0.9);
      if (s > bestScore) { bestScore = s; best = lb; }
    });
    return best;
  }

  /* ---------- 判定パターン ---------- */
  var KEIGO_NG = [
    { re: /おっしゃられ/g, fix: '「おっしゃる」「おっしゃいました」' },
    { re: /(?:いらっしゃ|なさ|くださ|召し上が)られ/g, fix: '尊敬語に「れる」を重ねない' },
    { re: /[おご][^\s、。,.「」:]{1,6}?になられ/g, fix: '「お(ご)〜になる」で止める' },
    { re: /(?:拝見|拝聴|拝読|拝受|拝借)させて(?:いただ|頂)/g, fix: '「拝見します」「拝見しました」' },
    { re: /ご拝(?:見|読|聴|受|察)/g, fix: '「拝見」だけで謙譲語' },
    { re: /お伺いさせて(?:いただ|頂)/g, fix: '「伺います」' },
    { re: /お(?:名前|電話番号|会社名|メールアドレス)様/g, fix: '物に「様」は付けない' }
  ];
  var KEIGO_VERBOSE = [
    { re: /よろしかったでしょうか/g, fix: '「よろしいでしょうか」' },
    { re: /(?:資料|お時間|お名前|ご連絡|メール|お電話|日程|ご都合|内容|サービス|弊社|私)の方(?=[をはにでがも、か])/g, fix: '「のほう」を取る' },
    { re: /[一-龥ァ-ヶーA-Za-z]{1,10}のほう(?=[をはにでがも、か])/g, fix: '「のほう」を取る' },
    { re: /(?:支店長|社長|部長|課長|次長|係長|専務|常務|会長|店長|所長|院長|代表)様/g, fix: '役職は敬称。「〇〇部長」か「部長の〇〇様」' },
    { re: /伺わせて(?:いただ|頂)/g, fix: '「伺います」' },
    { re: /させて(?:いただ|頂)いてもよろしいでしょうか/g, fix: '「〜してもよろしいでしょうか」' },
    { re: /でございますでしょうか/g, fix: '「でしょうか」' }
  ];
  var SASETE_RE = /させて(?:いただ|頂)/g, SASETE_MAX = 3;
  var CUSHION_RE = /お忙しいところ|お忙しい中|恐れ入りますが|恐縮ですが|大変恐縮|失礼ですが|差し支えなければ|お手数ですが|お手数をおかけ/g, CUSHION_MAX = 3;
  var APOLOGY_RE = /申し訳/g;
  var SUMIMASEN_RE = /すみません|すいません/g;

  var ROUGH_STRICT = /ふざけるな|ふざけんな|二度と(?:電話|かけ|連絡)|かけてくるな|電話してくるな|かけてこないで|連絡してこないで|しつこい|うるさい|うるせ|いい加減にし|切るぞ|訴える|警察|消費者センター|通報|営業妨害|黙れ|なめてん|舐めてん|てめえ|てめぇ|不愉快|失礼だろ|責任者を?出せ|迷惑(?:だ|です|なん|電話|して)/g;
  var ROUGH_CUST = /クレーム|お前|バカ|ばか|馬鹿|何回も?(?:かけ|電話)|何度も?(?:かけ|電話)|どこで(?:番号|調べ)|リストから(?:消|外|削)|いらないって|結構だって|忙しいんだよ|切るよ|消して(?:くれ|ください|おいて)/g;

  var PURPOSE_GENERIC = /の件で|ご案内|ご紹介|ご提案|お電話(?:いた|致)しました|お電話差し上げ|ご連絡(?:いた|致)しました|情報提供|情報交換/g;
  var DATE_RE = /\d{1,2}月\d{1,2}日|\d{1,2}\/\d{1,2}|\d{1,2}日|今週|来週|再来週|明日|明後日|あさって|週明け|(?:月|火|水|木|金|土|日)曜/g;
  var TIME_RE = /\d{1,2}時(?:半|\d{1,2}分)?|\d{1,2}:\d{2}|午前|午後|朝一|夕方/g;
  var NUM_RE = /(\d+(?:\.\d+)?)\s*(%|パーセント|割|倍|社|件|円|名|人|年|か月|ヶ月|カ月|ケ月|店舗|拠点|回線|席|アカウント|ユーザー)/g;

  var NAME_ASK = /お名前|ご氏名|フルネーム|漢字で|漢字は|どのような字|どなた様でしょう/g;
  var NAME_ECHO = /([一-龥々]{1,6}|[ァ-ヶー]{2,10}|[A-Za-z]{2,12})(?:様|さま|さん)(?:ですね|でございますね|でいらっしゃいますね|でよろしい|宛|あて)/g;
  var NAME_GENERIC = /^(?:担当者|担当|客|皆|御社|貴社|社長|部長|課長|代表|責任者|上長|奥|どちら|どなた)$/;
  var NAME_SELF = /(?:[一-龥々]{1,6}|[ァ-ヶー]{2,10})(?:と申します|といいます|と言います)|(?:担当|総務|経理|営業|人事|情シス|部|課)の[一-龥々]{1,6}です/g;
  var MAIL_ASK = /メールアドレス|メアド|アドレス|Eメール|メールで|メールにて|メールを/g;
  var MAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  var MAIL_SPOKEN_AT = /アットマーク|アット(?!ホーム)|@/;
  var MAIL_SPOKEN_DOT = /(?:ドット|\.)\s*(?:コム|シーオー|ジェーピー|ネット|com|co|jp|ne|net)/i;
  var CLOSE_RE = /ありがとうございました|ありがとうございます。?$|失礼いたします|失礼します/;

  function findAll(re, text, guard) {
    var out = [], m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (!guard || guard(m, text)) out.push({ s: m.index, e: m.index + m[0].length, t: m[0], m: m });
    }
    return out;
  }
  function dateGuard(m, text) {
    if (/^\d{1,2}日$/.test(m[0])) {
      if (/\d/.test(text[m.index - 1] || '')) return false;
      if (/^(?:間|あたり|当たり|中|以内|ほど|程度)/.test(text.slice(m.index + m[0].length, m.index + m[0].length + 3))) return false;
    }
    return true;
  }
  function timeGuard(m, text) {
    if (/時$/.test(m[0]) || /^\d{1,2}時$/.test(m[0])) {
      if (/^(?:間|点|期|的)/.test(text.slice(m.index + m[0].length, m.index + m[0].length + 1))) return false;
    }
    return true;
  }
  function roughGuard(m, text) {
    if (m[0].indexOf('迷惑') === 0 && text[m.index - 1] === 'ご') return false;
    return true;
  }
  function numGuard(m) {
    var v = parseFloat(m[1]), u = m[2];
    if (v === 1 && /^(?:名|人|件|社|年)$/.test(u)) return false;
    if (u === '年' && v >= 1900) return false;
    return true;
  }
  function snippet(text, s, e) {
    var a = Math.max(0, s - 10), b = Math.min(text.length, e + 12);
    return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\n/g, ' ') + (b < text.length ? '…' : '');
  }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function plainRe(words) {
    words = uniq(words.map(function (w) { return norm(w).trim(); }).filter(Boolean)).sort(function (a, b) { return b.length - a.length; });
    return words.length ? new RegExp(words.map(escRe).join('|'), 'gi') : null;
  }

  var STOP = ('メール,アドレス,メールアドレス,サービス,システム,オンライン,スケジュール,タイミング,メリット,コスト,サポート,プラン,データ,チェック,ミーティング,アポイント,アポ,アットマーク,アット,ドット,コム,ジェーピー,パーセント,ホームページ,サイト,ページ,カレンダー,リスト,クレーム,ビジネス,イメージ,ポイント,スタッフ,チーム,ケース,ニーズ,テーマ,レベル,タイプ,ペース,トーク,スクリプト,テレアポ,フルネーム,シーオー,ネット,メアド,バカ,ウェブ,パソコン,スマホ,インターネット,タイム,メモ,ファイル,サンプル,ちょっと,URL,OK,NG,PC,IS,co,jp,com,ne,net,www,http,https,Zoom,Teams,Meet,Google').split(',');

  function analyze(raw, cfg) {
    cfg = cfg || {};
    var rules = cfg.rules || {}, product = cfg.product || null;
    var limit = typeof rules.apologyLimit === 'number' ? rules.apologyLimit : 2;
    var base = norm(raw);
    var dict = applyDict(base, cfg.terms || []);
    var parsed = parseSpeakers(dict.text);
    var agent = parsed.labels.length ? (parsed.labels.indexOf(cfg.agentLabel) >= 0 ? cfg.agentLabel : guessAgent(parsed)) : null;
    var separated = !!agent;
    var isAgent = function (t) { return !separated || t.sp === agent; };
    var agentText = parsed.turns.filter(isAgent).map(function (t) { return t.text; }).join('\n');
    var custText = separated ? parsed.turns.filter(function (t) { return t.sp !== agent; }).map(function (t) { return t.text; }).join('\n') : '';
    var allText = parsed.turns.map(function (t) { return t.text; }).join('\n');
    var agentNum = numNorm(agentText), allNum = numNorm(allText);
    var checks = {};

    /* 1. 数値 */
    var need = product ? list(product.numbers) : [];
    var generic = findAll(NUM_RE, agentNum, numGuard);
    if (need.length) {
      var flat = agentNum.replace(/\s/g, '');
      var hit = need.filter(function (r) { return flat.indexOf(numNorm(norm(r)).replace(/\s/g, '')) >= 0; });
      var miss = need.filter(function (r) { return hit.indexOf(r) < 0; });
      checks.number = {
        state: hit.length === need.length ? 'ok' : hit.length ? 'warn' : 'ng',
        detail: '必須の数値 ' + hit.length + '/' + need.length + (miss.length ? '　未出：' + miss.join('、') : ''),
        ev: hit
      };
    } else {
      checks.number = {
        state: generic.length ? 'ok' : 'ng',
        detail: generic.length ? '数値あり（必須の数値は未設定。汎用検出）' : '数値が一度も出ていない',
        ev: uniq(generic.map(function (g) { return g.t; })).slice(0, 4)
      };
    }

    /* 2. 目的 */
    var pk = product ? list(product.purpose) : [];
    var pkRe = plainRe(pk);
    var pkHit = pkRe ? uniq(findAll(pkRe, agentText).map(function (h) { return h.t; })) : [];
    var pgHit = uniq(findAll(PURPOSE_GENERIC, agentText).map(function (h) { return h.t; }));
    if (pk.length) {
      checks.purpose = pkHit.length
        ? { state: 'ok', detail: '目的キーワードを話している', ev: pkHit }
        : pgHit.length
          ? { state: 'warn', detail: '用件は切り出したが、目的キーワードが出ていない（' + pk.join('、') + '）', ev: pgHit }
          : { state: 'ng', detail: '電話の目的を伝えていない', ev: [] };
    } else {
      checks.purpose = pgHit.length
        ? { state: 'ok', detail: '用件を切り出している（目的キーワードは未設定）', ev: pgHit }
        : { state: 'ng', detail: '電話の目的を伝えていない', ev: [] };
    }

    /* 3. プロダクト */
    var pnames = product ? uniq([product.name].concat(list(product.aliases)).filter(Boolean)) : [];
    var pRe = plainRe(pnames);
    var pHits = pRe ? findAll(pRe, agentText) : [];
    checks.product = !product
      ? { state: 'ng', detail: 'プロダクトが未登録。「辞書」タブで登録すると判定できる', ev: [] }
      : pHits.length
        ? { state: 'ok', detail: 'プロダクト名を ' + pHits.length + ' 回', ev: uniq(pHits.map(function (h) { return h.t; })) }
        : { state: 'ng', detail: '「' + product.name + '」を一度も言っていない', ev: [] };

    /* 4. アポ日付 */
    var dates = uniq(findAll(DATE_RE, allNum, dateGuard).map(function (h) { return h.t; }));
    var times = uniq(findAll(TIME_RE, allNum, timeGuard).map(function (h) { return h.t; }));
    checks.appo = dates.length && times.length
      ? { state: 'ok', detail: '日付と時間の両方が出ている', ev: dates.slice(0, 3).concat(times.slice(0, 2)) }
      : dates.length
        ? { state: 'warn', detail: '日付は出たが時間が決まっていない', ev: dates.slice(0, 3) }
        : times.length
          ? { state: 'warn', detail: '時間は出たが日付が決まっていない', ev: times.slice(0, 3) }
          : { state: 'ng', detail: 'アポの日付を打診していない', ev: [] };

    /* 5. 敬語 */
    var kHits = [];
    function pushK(pats, type) {
      pats.forEach(function (p) {
        findAll(p.re, agentText).forEach(function (h) {
          if (kHits.some(function (k) { return h.s < k.e && k.s < h.e; })) return;
          kHits.push({ s: h.s, e: h.e, text: h.t, fix: p.fix, type: type });
        });
      });
    }
    pushK(KEIGO_NG, 'ng');
    var extra = (rules.extraKeigo || []).filter(function (x) { return x && x.p; });
    extra.forEach(function (x) {
      var re = plainRe([x.p]);
      findAll(re, agentText).forEach(function (h) {
        if (kHits.some(function (k) { return h.s < k.e && k.s < h.e; })) return;
        kHits.push({ s: h.s, e: h.e, text: h.t, fix: x.fix || '言い換える', type: 'ng' });
      });
    });
    pushK(KEIGO_VERBOSE, 'verbose');
    var sasete = findAll(SASETE_RE, agentText).length;
    var cushion = findAll(CUSHION_RE, agentText).length;
    var kNotes = [];
    if (sasete > SASETE_MAX) kNotes.push({ text: '「させていただく」' + sasete + '回', fix: SASETE_MAX + '回まで。「〜します」で言い切る', type: 'verbose' });
    if (cushion > CUSHION_MAX) kNotes.push({ text: 'クッション言葉 ' + cushion + '回', fix: CUSHION_MAX + '回まで。用件を先に言う', type: 'verbose' });
    var kAll = kHits.concat(kNotes);
    var nNg = kAll.filter(function (k) { return k.type === 'ng'; }).length;
    var nVb = kAll.length - nNg;
    checks.keigo = {
      state: nNg ? 'ng' : nVb ? 'warn' : 'ok',
      detail: nNg || nVb ? '二重敬語 ' + nNg + '件／冗長な敬語 ' + nVb + '件' : '二重敬語・冗長な敬語なし',
      hits: kAll, ng: nNg, verbose: nVb, sasete: sasete, cushion: cushion, ev: []
    };

    /* 6. 謝罪回数 */
    var apo = findAll(APOLOGY_RE, agentText).length;
    var sumi = findAll(SUMIMASEN_RE, agentText).length;
    checks.apology = {
      state: apo <= limit ? 'ok' : 'ng', count: apo, limit: limit, sumimasen: sumi,
      detail: '「申し訳ありません」' + apo + '回（上限 ' + limit + '回）' + (sumi ? '　※「すみません」' + sumi + '回' : ''),
      ev: []
    };

    /* 7. 名前 */
    var asked = findAll(NAME_ASK, agentText).length > 0;
    var echo = findAll(NAME_ECHO, agentText, function (m) { return !NAME_GENERIC.test(m[1]); });
    var self = separated ? findAll(NAME_SELF, custText) : [];
    checks.name = echo.length || (asked && self.length)
      ? { state: 'ok', detail: echo.length ? '名前を復唱して確認している' : '名前を聞き、相手が名乗っている', ev: uniq(echo.concat(self).map(function (h) { return h.t; })).slice(0, 2) }
      : asked
        ? { state: 'warn', detail: '名前は聞いたが、復唱での確認が見当たらない', ev: [] }
        : self.length
          ? { state: 'warn', detail: '相手は名乗っているが、復唱していない', ev: [self[0].t] }
          : { state: 'ng', detail: '名前を聞いていない', ev: [] };

    /* 8. メール */
    var mails = uniq(findAll(MAIL_RE, allText).map(function (h) { return h.t; }));
    var spoken = MAIL_SPOKEN_AT.test(allText) && MAIL_SPOKEN_DOT.test(allText);
    var mAsked = findAll(MAIL_ASK, agentText).length > 0;
    checks.email = mails.length || spoken
      ? { state: 'ok', detail: 'メールアドレスを取得している', ev: mails.length ? ['アドレス ' + mails.length + '件（本文中）'] : ['読み上げ（アットマーク）'] }
      : mAsked
        ? { state: 'warn', detail: 'メールの話は出たが、アドレスを聞き取れていない', ev: [] }
        : { state: 'ng', detail: 'メールアドレスを聞いていない', ev: [] };

    /* イレギュラー：クレーム・言葉が荒い相手 */
    var extraRough = plainRe(list(rules.extraRough));
    function roughIn(text, custOnly) {
      var hs = findAll(ROUGH_STRICT, text, roughGuard);
      if (custOnly) hs = hs.concat(findAll(ROUGH_CUST, text));
      if (extraRough) hs = hs.concat(findAll(extraRough, text));
      return hs.sort(function (a, b) { return a.s - b.s; });
    }
    var irr = { auto: false, manual: !!cfg.manualIrregular, hits: [], endOk: false, tail: 0, tailOk: true };
    if (separated) {
      var firstIdx = -1;
      parsed.turns.forEach(function (t, i) {
        if (t.sp === agent) return;
        var hs = roughIn(t.text, true);
        if (hs.length) { irr.hits = irr.hits.concat(hs.map(function (h) { return h.t; })); if (firstIdx < 0) firstIdx = i; }
      });
      irr.auto = firstIdx >= 0;
      var agentTurns = parsed.turns.filter(isAgent);
      var last = agentTurns.length ? agentTurns[agentTurns.length - 1].text : '';
      irr.endOk = CLOSE_RE.test(last.trim());
      if (firstIdx >= 0) {
        irr.tail = parsed.turns.slice(firstIdx + 1).filter(isAgent).reduce(function (n, t) { return n + t.text.length; }, 0);
        irr.tailOk = irr.tail <= 60;
      }
    } else {
      var hs0 = roughIn(allText, false);
      irr.hits = hs0.map(function (h) { return h.t; });
      irr.auto = hs0.length > 0;
      var tailText = hs0.length ? allText.slice(hs0[0].e) : allText.slice(-80);
      irr.endOk = /ありがとうございました|失礼いたします|失礼します/.test(tailText);
      if (hs0.length) { irr.tail = tailText.length; irr.tailOk = irr.tail <= 120; }
    }
    irr.hits = uniq(irr.hits);
    irr.on = irr.auto || irr.manual;
    irr.ok = irr.endOk && irr.tailOk;

    /* 辞書まわり */
    var termUse = [];
    (cfg.terms || []).forEach(function (t) {
      var re = plainRe([t.term]);
      var c = re ? findAll(re, allText).length : 0;
      if (c) termUse.push({ term: t.term, count: c });
    });
    var known = {};
    STOP.forEach(function (w) { known[w.toLowerCase()] = 1; });
    (rules.ignoreTerms || []).forEach(function (w) { known[norm(w).toLowerCase()] = 1; });
    (cfg.terms || []).forEach(function (t) { known[norm(t.term).toLowerCase()] = 1; list(t.variants).forEach(function (v) { known[norm(v).toLowerCase()] = 1; }); });
    pnames.forEach(function (p) { known[norm(p).toLowerCase()] = 1; });
    var cand = {};
    findAll(/[ァ-ヴー]{3,}|[A-Za-z][A-Za-z0-9-]{1,}/g, allText.replace(MAIL_RE, ' ')).forEach(function (h) {
      var k = h.t.toLowerCase();
      if (known[k] || /^ー/.test(h.t)) return;
      if (parsed.labels.indexOf(h.t) >= 0) return;
      cand[h.t] = (cand[h.t] || 0) + 1;
    });
    var unknown = Object.keys(cand).sort(function (a, b) { return cand[b] - cand[a] || b.length - a.length; }).slice(0, 12)
      .map(function (k) { return { term: k, count: cand[k] }; });

    return {
      empty: !allText.trim(),
      turns: parsed.turns, labels: parsed.labels, agent: agent, separated: separated,
      checks: checks, irregular: irr, dictFixes: dict.fixes, termUse: termUse, unknown: unknown,
      productNames: pnames, purposeKeys: pk, chars: agentText.length
    };
  }

  var ORDER = ['number', 'purpose', 'product', 'appo', 'keigo', 'apology', 'name', 'email'];
  var LABEL = { number: '数値', purpose: '目的', product: 'プロダクト', appo: 'アポ日付', keigo: '二重敬語・冗長な敬語', apology: '謝罪の回数', name: '名前の確保', email: 'メールアドレスの確保' };
  var MAXPT = { number: 10, purpose: 10, product: 10, appo: 10, keigo: 15, apology: 15, name: 15, email: 15 };
  var GROUP = { script: ['number', 'purpose', 'product', 'appo'], keigo: ['keigo', 'apology'], capture: ['name', 'email'] };

  /* overrides: {checkKey: 'ok' | 'ng'} — モニター担当が手動で上書きした分 */
  function score(res, overrides, passLine) {
    overrides = overrides || {};
    passLine = Math.max(1, Math.min(ORDER.length, parseInt(passLine, 10) || 6));
    var st = {}, pt = {};
    ORDER.forEach(function (k) {
      var c = res.checks[k], s = overrides[k] || c.state, p;
      if (overrides[k]) p = s === 'ok' ? MAXPT[k] : 0;
      else if (k === 'keigo') p = Math.max(0, MAXPT[k] - 5 * c.ng - 2 * c.verbose);
      else if (k === 'apology') p = Math.max(0, MAXPT[k] - 5 * Math.max(0, c.count - c.limit));
      else p = s === 'ok' ? MAXPT[k] : s === 'warn' ? Math.round(MAXPT[k] / 2) : 0;
      st[k] = s; pt[k] = p;
    });
    var sum = function (keys) { return keys.reduce(function (n, k) { return n + pt[k]; }, 0); };
    var total = sum(ORDER), pass = ORDER.filter(function (k) { return st[k] === 'ok'; }).length;
    var verdict = pass >= passLine ? 'pass' : total >= 70 ? 'fix' : 'retrain';
    return {
      states: st, points: pt, total: total, pass: pass, of: ORDER.length, passLine: passLine, verdict: verdict,
      groups: { script: sum(GROUP.script), keigo: sum(GROUP.keigo), capture: sum(GROUP.capture) }
    };
  }

  /* 文字起こしの色付け用：1ターンぶんの範囲リストを返す */
  function marks(text, res, isAgentTurn, rules) {
    var out = [];
    function add(hs, cls, tip) {
      hs.forEach(function (h) {
        if (out.some(function (o) { return h.s < o.e && o.s < h.e; })) return;
        out.push({ s: h.s, e: h.e, cls: cls, tip: typeof tip === 'function' ? tip(h) : tip });
      });
    }
    rules = rules || {};
    if (isAgentTurn) {
      KEIGO_NG.forEach(function (p) { add(findAll(p.re, text), 'ng', p.fix); });
      (rules.extraKeigo || []).forEach(function (x) { var re = x && x.p ? plainRe([x.p]) : null; if (re) add(findAll(re, text), 'ng', x.fix || ''); });
      KEIGO_VERBOSE.forEach(function (p) { add(findAll(p.re, text), 'vb', p.fix); });
      add(findAll(APOLOGY_RE, text), 'ap', '謝罪');
      var pRe = plainRe(res.productNames || []);
      if (pRe) add(findAll(pRe, text), 'hit', 'プロダクト');
      var kRe = plainRe(res.purposeKeys || []);
      if (kRe) add(findAll(kRe, text), 'hit', '目的');
    }
    if (!res.separated || !isAgentTurn) {
      add(findAll(ROUGH_STRICT, text, roughGuard), 'rough', '荒い言葉');
      if (res.separated) add(findAll(ROUGH_CUST, text), 'rough', '荒い言葉');
      var er = plainRe(list(rules.extraRough));
      if (er) add(findAll(er, text), 'rough', '荒い言葉');
    }
    add(findAll(MAIL_RE, text), 'hit', 'メール');
    add(findAll(DATE_RE, text, dateGuard), 'hit', '日付');
    add(findAll(TIME_RE, text, timeGuard), 'hit', '時間');
    return out.sort(function (a, b) { return a.s - b.s; });
  }

  return { analyze: analyze, score: score, marks: marks, norm: norm, numNorm: numNorm, list: list, ORDER: ORDER, LABEL: LABEL, MAXPT: MAXPT, GROUP: GROUP };
})();
if (typeof module !== 'undefined') module.exports = TMEngine;
