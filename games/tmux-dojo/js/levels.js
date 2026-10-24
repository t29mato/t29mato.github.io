// Courses and key data for tmux 道場 (the browser game).
// A course is a fixed set of questions (問題), asked in a new order each
// run, on one house that carries on from question to question. Question
// types live in app.js. What the player reads is written in Japanese and
// shown in English through i18n.js when the page is in English.
(function () {
  'use strict';

  // macOS takes Ctrl+arrows for Mission Control, so on Apple devices the
  // resize keys are shown as Option+arrows (tmux's M-arrow binding).
  var tx = (window.ADV && window.ADV.i18n && window.ADV.i18n.t) || function (s) { return s; };

  var MAC = /Mac|iPhone|iPad/.test((navigator.platform || '') + ' ' + (navigator.userAgent || ''));

  // Key labels per action.
  var KEYS = {
    split_lr: ['%'],
    split_tb: ['"'],
    focus: ['←', '→', '↑', '↓', 'o', ';'],
    zoom: ['z'],
    close: ['x', 'y'],
    resize: MAC ? ['Option+←', 'Option+→', 'Option+↑', 'Option+↓'] : ['Ctrl+←', 'Ctrl+→', 'Ctrl+↑', 'Ctrl+↓'],
    new_window: ['c'],
    rename: [','],
    select_window: ['n', 'p', '0-9'],
    copy: ['[', 'PageUp', 'g', 'q'],
    page: ['[', 'PageUp', 'PageDown', 'q'],
    last_window: ['l'],
    break_pane: ['!'],
    detach: ['d'],
    swap: ['{', '}'],
    layout: ['Space'],
    layout_pick: (MAC ? ['Option+1', 'Option+2', 'Option+3', 'Option+4', 'Option+5'] : ['Alt+1', 'Alt+2', 'Alt+3', 'Alt+4', 'Alt+5']).concat(['Space']),
    join: [':', 'join-pane -s'],
    swap_window: [':', 'swap-window -t'],
    move_window: [':', 'move-window -t'],
    sync: [':', 'setw synchronize-panes'],
    display_panes: ['q', '0-9'],
    rotate: ['Ctrl+o', MAC ? 'Option+o' : 'Alt+o'],
    command: [':'],
    rename_pane: [':', 'select-pane -T'],
    search: ['[', '?', '/', 'n'],
    yank: ['Home', 'Space', 'End', 'Enter'],
    paste: [']'],
    kill_window: ['&', 'y'],
    new_session: [':'],
    rename_session: ['$'],
    choose: ['s', '(', ')', 'L']
  };

  // Human-readable hint for an action, like key() in the shell script.
  var HINTS = {
    split_lr: '%（Shift+5）',
    split_tb: '"（ダブルクォート）',
    focus: '矢印キー（o で次のペインへ順に、; で直前のペインへ）',
    zoom: 'z（もう一度押すと元に戻る）',
    close: 'x → 確認に y',
    resize: MAC ? 'Option+矢印キー（prefix のあと Option を押したまま連打できる。Mac では Ctrl+矢印は macOS に取られる）' : 'Ctrl+矢印キー（prefix のあと Ctrl を押したまま連打できる。Option/Alt+矢印でも 5 マスずつ動く）',
    new_window: 'c',
    select_window: 'n / p（次・前）か、番号キー',
    rename: ',（カンマ）→ 名前を入力して Enter',
    copy: '[ （抜けるときは q）',
    page: '[ でコピーモード → PageUp で 1 ページ上へ（PageDown で下へ。抜けるときは q）',
    last_window: 'l（直前のウィンドウへ戻る）',
    break_pane: '!（Shift+1）。このペインが新しいウィンドウになる',
    detach: 'd',
    swap: '{ で前のペインと、} で次のペインと入れ替える（自分のペインが動く）',
    layout: 'Space で並べ方が順に変わる（Alt+1〜5 で直接選べる。5 が田の字 tiled）',
    rename_pane: ': → select-pane -T 名前 → Enter',
    search: '[ でコピーモード → ? で上向きに検索（/ は下向き）→ 文字を打って Enter。n で次を探す',
    yank: 'コピーモードで行へ動き、Space で選び始め、Enter でコピー（Space を押した所からカーソルまでが写る。emacs 式なら C-Space と M-w）',
    paste: ']（コピーしたものを貼る）',
    kill_window: '&（Shift+7）→ 確認に y',
    new_session: ':（コマンド入力）→ new -s 名前 → Enter',
    rename_session: '$ → 名前を入力して Enter',
    choose: 's で一覧（↑ ↓ と Enter）か、( ) で前・次のセッションへ（L で直前のセッションへ）',
    layout_pick: MAC ? 'Option+1〜5 で並べ方を選ぶ（Space で順に変わる）' : 'Alt+1〜5 で並べ方を選ぶ（Space で順に変わる）',
    join: ': → join-pane -s 番号 → Enter（-h で左右に）',
    swap_window: ': → swap-window -t 番号 → Enter',
    move_window: ': → move-window -t 番号 → Enter',
    sync: ': → setw synchronize-panes on → Enter（off で戻す）',
    display_panes: 'q で番号を出し、1 秒のうちに番号を押す',
    rotate: MAC ? 'Ctrl+o でペインを 1 つずつ前へ回す（Option+o で後ろへ）' : 'Ctrl+o でペインを 1 つずつ前へ回す（Alt+o で後ろへ）',
    command: ':（コマンド入力）→ コマンドを打って Enter'
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
    page: ['コピーモードの 1 ページは PageUp / PageDown。vi 式は Ctrl+u / Ctrl+d で半ページ、emacs 式は Alt+v / Ctrl+v で 1 ページ。', 'prefix → PageUp なら、コピーモードに入りながら 1 ページ上へ。'],
    last_window: ['prefix → l は last-window。二つのウィンドウを行き来するなら、番号より速い。ステータスバーでは直前のウィンドウに - が付く。'],
    break_pane: ['! は break-pane。逆に、別のウィンドウのペインをここに連れてくるのは join-pane（prefix → : で join-pane -s 番号）。'],
    detach: ['デタッチしてもセッションは裏で動き続ける。SSH が切れても作業は残る。tmux a は tmux attach の略。',
      'セッションが二つ以上あるときは tmux attach -t 名前 で選んで入る。-t を省くと、最後に使っていたセッションに入る。'],
    swap: ['prefix → C-o で、ウィンドウのペイン全部を回転させる（rotate-window）。'],
    layout: ['Alt+1〜5 で並べ方を直接選べる。1 は横に均等、2 は縦に均等、5 が田の字（tiled）。'],
    rename_pane: ['ペインの名前は pane-border-status を top にすると、枠の上に出る。'],
    search: ['vi 式は / と ?、emacs 式は C-s と C-r で検索する。n で同じ向きに、N で逆向きに次を探す。'],
    yank: ['tmux の v は矩形選択（四角く選ぶ）の切り替えで、y には割り当てがない。v と y で選んでコピーするのは vim のやり方。',
      'コピーモードに入ると、カーソルはシェルのカーソルの場所（プロンプトの行）にある。写るのは Space を押した所からカーソルまで。行の頭は Home（vi 式は 0、emacs 式は C-a）、行の終わりは End（$ / C-e）。'],
    paste: ['prefix → = で、これまでにコピーしたもの（バッファ）の一覧から選んで貼れる。prefix → # で一覧を見るだけ。'],
    kill_window: ['& も確認付き。ウィンドウの中のペインが全部閉じる。'],
    new_session: ['外からは tmux new -s 名前。中からなら prefix → : で new -s 名前。できたセッションにそのまま移る。'],
    rename_session: ['セッションの名前は、外から tmux attach -t 名前 で選ぶときに使う。'],
    choose: ['s はセッションの一覧、w はウィンドウまで含めた一覧（どちらも choose-tree）。( と ) は前後のセッションへ、L は直前のセッションへ。', 'セッションは名前の順に並ぶ（tmux ls も一覧も）。( と ) はその順で前後へ回る。'],
    layout_pick: ['Alt+1〜5 は even-horizontal（横に均等）、even-vertical（縦に均等）、main-horizontal（上に大きく）、main-vertical（左に大きく）、tiled（田の字）。Alt+6・7 はその鏡写し。',
      'main-horizontal の大きいペインは main-pane-height（既定 24 行）、main-vertical は main-pane-width（既定 80 列）の大きさになる。'],
    join: ['join-pane は break-pane の逆。-s 2 はウィンドウ 2 のいまのペイン、-s 2.1 はウィンドウ 2 のペイン 1。-h で左右に並べる。', 'bind J command-prompt -p "join pane from:" "join-pane -s \'%%\'" と書くと、番号だけ打てばよくなる。'],
    swap_window: ['swap-window -t 番号 で、いまのウィンドウとその番号のウィンドウが入れ替わる。tmux 3.8 では -d を付けたときだけ、動かしたウィンドウについて行く。', 'bind -r < swap-window -d -t -1 と書くと、prefix → < でいまのウィンドウを左へずらしていける。'],
    move_window: ['move-window -t 番号 は空いている番号へ動かす（使われている番号なら index in use）。番号を詰め直すのは move-window -r。set -g renumber-windows on なら閉じるたびに詰まる。'],
    sync: ['synchronize-panes は値を書かなければ on と off が入れ替わる。bind S setw synchronize-panes と書いておく人が多い。', '同期は打った文字だけ。prefix のキーは同期しない。'],
    display_panes: ['番号が出ているのは display-panes-time（既定 1 秒）のあいだ。set -g display-panes-time 3000 で長くできる。'],
    rotate: ['prefix → Ctrl+o で、ペインの中身が 1 つずつ前へ回る（rotate-window）。prefix → Alt+o は後ろへ。ペインの番号は場所の番号なので、回ると中身の番号が変わる。'],
    command: ['キーのない操作は prefix → : で打つ。join-pane は joinp、swap-window は swapw、move-window は movew と短く打てる。']
  };

  function tipsFor(action) {
    return (TIPS[action] || []).map(function (s) { return tx(s); });
  }

  function prefixLabel(prefix) {
    return prefix === 'C-a' ? 'Ctrl+a' : 'Ctrl+b';
  }

  function hint(prefix, action) {
    if (!HINTS[action]) return '';
    return prefixLabel(prefix) + ' を押して離してから ' + HINTS[action];
  }

  // The 目安 is per question now (limitFor below); a course's `limit` is
  // only what older runs, logged before that, are measured against. Past
  // the 目安 nothing is skipped; the 手順 is on screen from the start anyway.
  // `rankMul` scales the rank thresholds for courses whose questions take
  // several keys (入門 1.35 keys a question, 中級 1.7, 上級 2.9 on average, so
  // the same player lands on about the same Lv on each). Bump `ver`
  // whenever `qs` or the rules change, so older runs can be told apart in
  // the history (ver 2: no skipping, no +5 秒). The server keeps one ver for
  // every course (rules.js), so 上級's session questions came without a
  // bump: its all-time board mixes runs from before (accepted).
  // The ids stay easy / normal / hard so older records carry over.
  var COURSES = [
    {
      id: 'easy', title: '入門', mode: '手ならし', limit: 12, rankMul: 1, ver: 2, recommended: true,
      plan: { cols: 3, rows: 1, cells: 3, lit: 0 },
      desc: '分割・移動・全画面・閉じる・ウィンドウの作成と切り替え。1 問 1〜5 手（閉じるは移動も入る）。',
      qs: ['split_lr', 'focus', 'zoom', 'split_tb', 'close', 'unzoom', 'focus', 'new_window', 'select_window', 'split_lr', 'close', 'focus', 'zoom', 'select_window', 'split_tb']
    },
    {
      id: 'normal', title: '中級', mode: '腕試し', limit: 14, rankMul: 1.25, ver: 2,
      plan: { cols: 4, rows: 2, cells: 8, lit: 1 },
      desc: '大きさ・名前・入れ替え・ウィンドウを閉じる／戻る・ペインを別ウィンドウに・ページ送り・デタッチも混ざる。1 問 1〜5 手。',
      qs: ['focus', 'resize', 'swap', 'rename', 'close', 'kill_window', 'copy_top', 'split_tb', 'swap', 'select_window', 'zoom', 'new_window', 'detach_attach', 'last_window', 'break_pane', 'unzoom', 'close', 'split_lr', 'rename', 'copy_page']
    },
    {
      id: 'hard', title: '上級', mode: '真剣勝負', limit: 18, rankMul: 1.6, ver: 2,
      plan: { cols: 5, rows: 4, cells: 20, lit: 6 },
      desc: '1 問で 2〜8 手。セッションを作る・移る・attach -t で入る、履歴の検索も混ざる。考える前に手が動くか。',
      qs: ['find_zoom', 'trident', 'two_akima', 'new_and_home', 'swap_zoom', 'split_lr', 'yank_paste', 'copy_top', 'session_new', 'trident', 'kill_window', 'session_switch', 'session_attach', 'focus', 'resize', 'copy_search']
    },
    // 達人: for people who already use tmux. What the other houses do not
    // drill: join-pane, swap-window and move-window, the layouts, typing
    // into every pane at once, display-panes, rotate-window, a search then
    // a copy, and commands that have no key. `en`: its English name (the
    // belt 達人 is "Expert"). rankMul 1.8: a bot following the 手順 at three
    // paces took 1.10–1.19 times as long a question here as on 上級
    // (typing the commands), so the same hands get the same belt on both.
    {
      id: 'pro', title: '達人', en: 'Pro', mode: '使っている人へ', limit: 18, rankMul: 1.8, ver: 2, expert: true,
      plan: { cols: 6, rows: 4, cells: 24, lit: 9 },
      desc: 'tmux をもう使っている人へ。ペインを連れてくる・ウィンドウの入れ替え・並べ方・全部のペインに同時に打つ・番号で飛ぶ・検索してコピー・キーのないコマンド。',
      qs: ['join_pane', 'layout', 'swap_window', 'sync_panes', 'pane_jump', 'rotate', 'search_yank', 'move_window', 'layout_cycle', 'join_pane_h', 'new_window_named', 'kill_session', 'layout', 'pane_jump']
    }
  ];

  // 今日の達人: one question a day from the 達人 house, the same for
  // everyone (dailyPick), without its 手順 (they come out after PEEK_AFTER
  // seconds or a wrong key, and that is kept). Timed, with the fewest keys
  // beside the time, on a board of its own. No title: one question is no
  // run of a house.
  var DAILY = {
    id: 'daily', title: '今日の達人', mode: '1 問', limit: 12, rankMul: 1, ver: 2, daily: true, blind: true,
    plan: { cols: 1, rows: 1, cells: 1, lit: 0 },
    desc: '達人の問題が 1 日 1 問。手順なしで、速さと押したキーの少なさを競う。', qs: []
  };

  // The same random numbers as app.js and the server (rules.js) make from
  // a seed: the day's order and the day's question.
  function rng(seed) {
    var h = 1779033703 ^ seed.length;
    for (var i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }

  // The question of 今日の達人 on `day` (YYYY-MM-DD, Japan): one of the
  // 達人 house's question types, by the day.
  function dailyPool() {
    var pro = COURSES.filter(function (c) { return c.id === 'pro'; })[0], out = [];
    pro.qs.forEach(function (t) { if (out.indexOf(t) < 0) out.push(t); });
    return out;
  }
  function dailyPick(day) {
    var pool = dailyPool();
    return pool[Math.floor(rng(day + ':daily')() * pool.length)];
  }

  // 稽古: the recall drill. Questions without their 手順 (they come out after
  // PEEK_AFTER seconds or a wrong key), picked one at a time by how often
  // the key is needed in real tmux (DRILL_FREQ) and how it has gone lately
  // (records.js drillPick), for as long as the player likes. No board, no
  // ghost; its runs still count towards what you have learnt.
  var KEIKO = {
    id: 'keiko', title: '稽古', mode: '手順なし', limit: 14, rankMul: 1.3, ver: 2, practice: true, drill: true,
    plan: { cols: 3, rows: 3, cells: 9, lit: 4 },
    desc: '手順を見ずに思い出す。問題は終わりなく続き、やめると結果が出る。', qs: []
  };

  // How often each question's keys are needed in real tmux: 3 all day,
  // 2 now and then, 1 rarely (the long combos). Unknown types count as 1.
  var DRILL_FREQ = {
    focus: 3, split_lr: 3, split_tb: 3, zoom: 3, unzoom: 3, new_window: 3, select_window: 3, last_window: 3,
    copy_top: 3, copy_page: 3, copy_search: 3, close: 3, detach_attach: 3,
    resize: 2, rename: 2, swap: 2, kill_window: 2, break_pane: 2, session_new: 2, session_switch: 2, session_attach: 2,
    find_zoom: 1, trident: 1, two_akima: 1, new_and_home: 1, swap_zoom: 1, yank_paste: 1
  };

  // The 目安 of a question, in seconds, from how many moves (prefix + key)
  // its type takes: a split is one, closing a pane you must walk to is
  // four, 二つ閉じる eight. A type that says nothing counts as two.
  var STEPS_DEFAULT = 2;
  function limitFor(steps) {
    return 4 + 3 * (typeof steps === 'number' ? steps : STEPS_DEFAULT);
  }

  // A question type counts as learnt (覚えた) after this many solves in a
  // row within half its 目安, with no wrong key, no overrun and without the
  // folded 手順 having been shown. Its 手順 then stays folded until the 目安
  // passes.
  var LEARNT_AFTER = 5;

  // A learnt question's steps stay folded this many seconds, to try from memory.
  var PEEK_AFTER = 4;

  // The clock stops while the tab is away. A run paused for longer than
  // this, in all, stays in the records but is not sent to the ranking.
  var PAUSE_MAX = 3;

  // 腕前 (skill level), Lv 1 to 30, from seconds per question (after
  // penalties, divided by the course's rankMul): 10 秒 is Lv 1, 1.2 秒 Lv 30,
  // evenly on a log scale. The title is the run rank for the same pace.
  var LV_SLOW = 10, LV_FAST = 1.2, LV_MAX = 30;
  function levelFor(pace) {
    var t = (Math.log(LV_SLOW) - Math.log(pace)) / (Math.log(LV_SLOW) - Math.log(LV_FAST));
    return Math.max(1, Math.min(LV_MAX, 1 + Math.floor(t * (LV_MAX - 1) + 1e-9)));
  }
  // The pace that reaches level `lv`.
  function paceFor(lv) {
    var t = (lv - 1) / (LV_MAX - 1);
    return Math.exp(Math.log(LV_SLOW) - t * (Math.log(LV_SLOW) - Math.log(LV_FAST)));
  }

  // The day in Japan (YYYY-MM-DD): today's course asks in the same order for
  // everyone, so the ランキング compares like with like.
  function dayKey(d) {
    return new Date((d || new Date()).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  // Titles (帯) by average seconds per question, after penalties (and
  // rankMul), fastest first. Reading the order and pressing one move takes
  // a practised hand about 2 秒; 8 秒 is reading the 手順 step by step. Past
  // 黒帯 the belt stays black and gains gold stripes; 名人 wears the red one.
  // `en` is what English shows beside the kanji: romaji · meaning.
  var RANKS = [
    { max: 1.3, title: '名人', romaji: 'Meijin', en: 'Grand Master', belt: 'red' },
    { max: 1.8, title: '達人', romaji: 'Tatsujin', en: 'Expert', belt: 'black', stripes: 3 },
    { max: 2.5, title: '師範', romaji: 'Shihan', en: 'Master', belt: 'black', stripes: 2 },
    { max: 3.5, title: '師範代', romaji: 'Shihan-dai', en: 'Assistant Master', belt: 'black', stripes: 1 },
    { max: 4.5, title: '黒帯', romaji: 'Kuro-obi', en: 'Black Belt', belt: 'black' },
    { max: 6, title: '茶帯', romaji: 'Cha-obi', en: 'Brown Belt', belt: 'brown' },
    { max: 8, title: '緑帯', romaji: 'Midori-obi', en: 'Green Belt', belt: 'green' },
    { max: Infinity, title: '白帯', romaji: 'Shiro-obi', en: 'White Belt', belt: 'white' }
  ];

  // お手本 is this title's pace; from this one up, the next house is suggested.
  var PAR_RANK = '師範代', STEP_UP_RANK = '黒帯';

  // Saves from older versions used these titles (the RPG, the house, then
  // the dan grades). Each maps to a belt at least as high.
  var OLD_RANKS = {
    '伝説の勇者': '師範', '勇者': '師範代', '戦士': '黒帯', '見習い剣士': '緑帯', '村人': '白帯',
    '名匠': '師範', 'からくり師': '師範代', '屋敷守': '黒帯', '仕掛け番': '緑帯',
    '三段': '黒帯', '初段': '緑帯', '見習い': '白帯'
  };

  // The ladder entry of a title (an old name included), or null.
  function rankInfo(title) {
    var t = OLD_RANKS[title] || title;
    for (var i = 0; i < RANKS.length; i++) if (RANKS[i].title === t) return RANKS[i];
    return null;
  }

  // Where a title stands on the ladder: 0 at the top; past the end when unknown.
  function rankIndex(title) {
    var r = rankInfo(title);
    return r ? RANKS.indexOf(r) : RANKS.length;
  }

  // `mul` is the course's rankMul: a hard question may take twice as long.
  function rankFor(avg, mul) {
    var a = avg / (mul || 1);
    for (var i = 0; i < RANKS.length; i++) if (a <= RANKS[i].max) return RANKS[i].title;
    return RANKS[RANKS.length - 1].title;
  }

  // The title a course time holds, the next one up, the seconds it needs on
  // this course (misses included), how far the time is from it in all and
  // per question. At the top there is no next. `held`, a title the house
  // has reached, counts when it is higher than the time's (a title carried
  // over from the dan days): the next one is then the one above it.
  function nextRank(course, time, n, held) {
    n = n || course.qs.length;
    var mul = course.rankMul || 1;
    var rank = rankFor(time / n, mul);
    if (held && rankIndex(held) < rankIndex(rank)) rank = rankInfo(held).title;
    var i = rankIndex(rank);
    if (i <= 0) return { rank: rank, next: null, need: null, gap: null, gapQ: null };
    var need = RANKS[i - 1].max * mul * n;
    return { rank: rank, next: RANKS[i - 1].title, need: need, gap: time - need, gapQ: (time - need) / n };
  }

  // お手本, the target time for a course: 師範代 pace on every question.
  // `n` overrides the number of questions (the 苦手の稽古 picks its own).
  function par(course, n) {
    return Math.round((n || course.qs.length) * rankInfo(PAR_RANK).max * (course.rankMul || 1));
  }

  // Names shown on screen, in the page's language (i18n.js). A course with
  // `en` has its own English name (達人 in Japanese is a belt too).
  var EN = !!(window.ADV && window.ADV.i18n && window.ADV.i18n.lang === 'en');
  [].concat(COURSES, [KEIKO, DAILY]).forEach(function (c) { c.title = EN && c.en ? c.en : tx(c.title); c.mode = tx(c.mode); c.desc = tx(c.desc); });

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
    PAR_RANK: PAR_RANK,
    STEP_UP_RANK: STEP_UP_RANK,
    rankInfo: rankInfo,
    rankIndex: rankIndex,
    rankFor: rankFor,
    nextRank: nextRank,
    par: par,
    KEIKO: KEIKO,
    DAILY: DAILY,
    rng: rng,
    dailyPool: dailyPool,
    dailyPick: dailyPick,
    DRILL_FREQ: DRILL_FREQ,
    LEARNT_AFTER: LEARNT_AFTER,
    STEPS_DEFAULT: STEPS_DEFAULT,
    limitFor: limitFor,
    PAUSE_MAX: PAUSE_MAX,
    LV_MAX: LV_MAX,
    levelFor: levelFor,
    paceFor: paceFor,
    dayKey: dayKey,
    MISS_PENALTY: 2,
    GUIDE_AT: 1.5,
    PEEK_AFTER: PEEK_AFTER
  };
})();
