// Courses and key data for tmux からくり屋敷 (the browser game).
// A course is a fixed set of questions (仕掛け), asked in a new order each
// run. Question types live in app.js. Everything the player reads is
// Japanese; code identifiers stay English.
(function () {
  'use strict';

  // macOS takes Ctrl+arrows for Mission Control, so on Apple devices the
  // resize keys are shown as Option+arrows (tmux's M-arrow binding).
  var MAC = /Mac|iPhone|iPad/.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));

  // Key labels per action.
  var KEYS = {
    split_lr: ['%'],
    split_tb: ['"'],
    focus: ['←', '→', '↑', '↓'],
    zoom: ['z'],
    close: ['x', 'y'],
    resize: MAC ? ['Option+←', 'Option+→', 'Option+↑', 'Option+↓'] : ['Ctrl+←', 'Ctrl+→', 'Ctrl+↑', 'Ctrl+↓'],
    new_window: ['c'],
    rename: [','],
    select_window: ['n', 'p', '0-9'],
    copy: ['[', 'PageUp', 'g', 'q'],
    detach: ['d'],
    swap: ['{', '}'],
    layout: ['Space'],
    rename_pane: [':', 'select-pane -T'],
    search: ['[', '?', '/', 'n'],
    yank: ['Space', 'Enter'],
    paste: [']'],
    kill_window: ['&', 'y'],
    new_session: [':', 'new -s 名前'],
    rename_session: ['$'],
    choose: ['s', '(', ')']
  };

  // Human-readable hint for an action, like key() in the shell script.
  var HINTS = {
    split_lr: '%（Shift+5）',
    split_tb: '"（ダブルクォート）',
    focus: '矢印キー',
    zoom: 'z（もう一度押すと元に戻る）',
    close: 'x → 確認に y',
    resize: MAC ? 'Option+矢印キー（prefix のあと Option を押したまま連打できる。Mac では Ctrl+矢印は macOS に取られる）' : 'Ctrl+矢印キー（prefix のあと Ctrl を押したまま連打できる。Option/Alt+矢印でも 5 マスずつ動く）',
    new_window: 'c',
    select_window: 'n / p（次・前）か、番号キー',
    rename: ',（カンマ）→ 名前を入力して Enter',
    copy: '[ （抜けるときは q）',
    detach: 'd',
    swap: '{ で前のペインと、} で次のペインと入れ替える（自分のペインが動く）',
    layout: 'Space で並べ方が順に変わる（Alt+1〜5 で直接選べる。5 が田の字 tiled）',
    rename_pane: ': → select-pane -T 名前 → Enter',
    search: '[ でコピーモード → ? で上向きに検索（/ は下向き）→ 文字を打って Enter。n で次を探す',
    yank: 'コピーモードで Space で選び始め、Enter でコピー（emacs 式なら C-Space と M-w）',
    paste: ']（コピーしたものを貼る）',
    kill_window: '&（Shift+7）→ 確認に y',
    new_session: ':（コマンド入力）→ new -s 名前 → Enter',
    rename_session: '$ → 名前を入力して Enter',
    choose: 's で一覧（↑ ↓ と Enter）か、( ) で前・次のセッションへ'
  };

  // Tips: why a key is what it is, neighbours worth knowing, and how to
  // change it. Checked against tmux 3.8's default bindings and man page.
  var TIPS = {
    split_lr: ['新しいペインは、設定に bind % split-window -h -c "#{pane_current_path}" と書くと、今いるディレクトリで開く。'],
    split_tb: ['% と " は覚えにくいので、| と - に割り当て直す人が多い（bind | split-window -h など）。'],
    focus: ['prefix → ; で直前のペインに戻る。prefix → o でペインを順に巡る。', 'prefix → q でペインに番号が出る。出ている間に番号を押すと、そのペインへ飛ぶ。'],
    zoom: ['全画面のあいだは、ステータスバーのウィンドウ名に Z が付く。ペインを移動すると全画面は解ける。'],
    close: ['x は確認付きの kill-pane。y は「本当に閉じる？ (y/n)」への yes。確認を省くなら bind x kill-pane と書く。', 'シェルで exit を打つか C-d を押しても、確認なしでそのペインが閉じる。'],
    resize: ['prefix のあと 0.5 秒（repeat-time）以内なら、prefix なしで続けて押せる。Ctrl+矢印は 1 マス、Alt+矢印は 5 マス。', 'set -g mouse on にすると、境目をマウスでドラッグして大きさを変えられる。'],
    new_window: ['c は create。番号は 0 から始まる。set -g base-index 1 で 1 から。'],
    rename: ['ウィンドウ名は、普段は実行中のコマンド名に自動で変わる（automatic-rename）。名前を付けると、そのウィンドウでは自動で変わらなくなる。'],
    select_window: ['prefix → l で直前のウィンドウへ。prefix → w で一覧から選べる。', "prefix → ' で番号を打って飛べる。10 番以降に便利。"],
    copy: ['prefix → PageUp で、コピーモードに入りながら 1 ページ上へ。', 'コピーモードの方式は mode-keys で決まる。EDITOR か VISUAL に vi が入っていれば vi 式、それ以外は emacs 式。'],
    detach: ['デタッチしてもセッションは裏で動き続ける。SSH が切れても作業は残る。tmux a は tmux attach の略。'],
    swap: ['prefix → C-o で、ウィンドウのペイン全部を回転させる（rotate-window）。'],
    layout: ['Alt+1〜5 で並べ方を直接選べる。1 は横に均等、2 は縦に均等、5 が田の字（tiled）。'],
    rename_pane: ['ペインの名前は pane-border-status を top にすると、枠の上に出る。'],
    search: ['vi 式は / と ?、emacs 式は C-s と C-r で検索する。n で同じ向きに、N で逆向きに次を探す。'],
    yank: ['tmux の v は「矩形選択の切り替え」で、y には割り当てがない。v と y で選んでコピーするのは vim の流儀。'],
    paste: ['prefix → = で、これまでにコピーしたもの（バッファ）の一覧から選んで貼れる。prefix → # で一覧を見るだけ。'],
    kill_window: ['& も確認付き。ウィンドウの中のペインが全部閉じる。'],
    new_session: ['外からは tmux new -s 名前。中からなら prefix → : で new -s 名前。'],
    rename_session: ['セッションの名前は、外から tmux attach -t 名前 で選ぶときに使う。'],
    choose: ['s はセッションの一覧、w はウィンドウまで含めた一覧（どちらも choose-tree）。( と ) は前後のセッションへ。']
  };

  function tipsFor(action) {
    return TIPS[action] || [];
  }

  function prefixLabel(prefix) {
    return prefix === 'C-a' ? 'Ctrl+a' : 'Ctrl+b';
  }

  function hint(prefix, action) {
    if (!HINTS[action]) return '';
    return prefixLabel(prefix) + ' を押して離してから ' + HINTS[action];
  }

  // `limit` is the 目安 in seconds per question. Past it nothing is skipped:
  // the keys light up, and at 1.5 times it the step-by-step 指南 appears.
  // `rankMul` scales the rank thresholds for courses whose questions take
  // several keys. Bump `ver` whenever `qs` or the rules change, so older
  // runs can be told apart in the history (ver 2: no skipping, no +5 秒).
  // The ids stay easy / normal / hard so older records carry over.
  var COURSES = [
    {
      id: 'easy', title: '三間屋敷', mode: '手ならし', limit: 12, rankMul: 1, ver: 2,
      plan: { cols: 3, rows: 1, cells: 3, lit: 0 },
      desc: '襖を立てる・間を渡る・大広間・間を閉じる・棟を渡る。1 仕掛け 1 キー。',
      qs: ['split_lr', 'focus', 'zoom', 'split_tb', 'close', 'unzoom', 'focus', 'new_window', 'select_window', 'split_lr', 'close', 'focus', 'zoom', 'select_window', 'split_tb']
    },
    {
      id: 'normal', title: '八間屋敷', mode: 'おすすめ', limit: 14, rankMul: 1.3, ver: 2, recommended: true,
      plan: { cols: 4, rows: 2, cells: 8, lit: 1 },
      desc: '襖をずらす・名札を掛ける・部屋が回る・棟を閉める・巻物も混ざる。',
      qs: ['focus', 'resize', 'swap', 'rename', 'close', 'kill_window', 'copy_top', 'split_tb', 'swap', 'select_window', 'zoom', 'new_window', 'focus', 'resize', 'kill_window', 'unzoom', 'close', 'split_lr', 'rename', 'focus']
    },
    {
      id: 'hard', title: '百間屋敷', mode: '真剣勝負', limit: 18, rankMul: 2, ver: 2,
      plan: { cols: 5, rows: 4, cells: 20, lit: 6 },
      desc: '1 仕掛けで 2〜3 手。考える前に手が動くか。',
      qs: ['find_zoom', 'trident', 'two_akima', 'new_and_home', 'swap_zoom', 'split_lr', 'find_zoom', 'copy_top', 'two_akima', 'trident', 'kill_window', 'swap_zoom', 'new_and_home', 'focus', 'resize', 'find_zoom']
    }
  ];

  // Ranks by average seconds per question, after penalties.
  var RANKS = [
    { max: 1.6, title: '名匠' },
    { max: 2.4, title: 'からくり師' },
    { max: 3.4, title: '屋敷守' },
    { max: 5, title: '仕掛け番' },
    { max: Infinity, title: '見習い' }
  ];

  // Saves from the old game used these titles.
  var OLD_RANKS = { '伝説の勇者': '名匠', '勇者': 'からくり師', '戦士': '屋敷守', '見習い剣士': '仕掛け番', '村人': '見習い' };

  // `mul` is the course's rankMul: a hard question may take twice as long.
  function rankFor(avg, mul) {
    var a = avg / (mul || 1);
    for (var i = 0; i < RANKS.length; i++) if (a <= RANKS[i].max) return RANKS[i].title;
    return RANKS[RANKS.length - 1].title;
  }

  // 当主の刻, the target time for a course: からくり師 pace on every question.
  function par(course) {
    return Math.round(course.qs.length * RANKS[1].max * (course.rankMul || 1));
  }

  window.ADV = window.ADV || {};
  window.ADV.levels = {
    KEYS: KEYS,
    HINTS: HINTS,
    hint: hint,
    prefixLabel: prefixLabel,
    TIPS: TIPS,
    tipsFor: tipsFor,
    COURSES: COURSES,
    RANKS: RANKS,
    OLD_RANKS: OLD_RANKS,
    rankFor: rankFor,
    par: par,
    MISS_PENALTY: 2,
    GUIDE_AT: 1.5
  };
})();
