// Level design for the browser version of tmux打.
// Chapter 1 mirrors the 11 levels of the shell script; chapters 2 and 3 and
// the arena exist only in the browser.
// Everything the player reads is Japanese. Code identifiers stay English.
(function () {
  'use strict';

  var LAST_LEVEL = 24;

  var CHAPTERS = [
    { n: 1, first: 1, last: 11, title: 'はじまりの村', sub: '初級', bgm: 'village' },
    { n: 2, first: 12, last: 19, title: '試練の塔', sub: '中級', bgm: 'tower' },
    { n: 3, first: 20, last: 24, title: '魔王の城', sub: '上級', bgm: 'castle' }
  ];

  function chapterOf(level) {
    for (var i = 0; i < CHAPTERS.length; i++) if (level <= CHAPTERS[i].last) return CHAPTERS[i];
    return CHAPTERS[CHAPTERS.length - 1];
  }

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
    swap: '{ で前の窓と、} で次の窓と入れ替える（自分の窓が動く）',
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
    split_lr: ['新しい窓は、設定に bind % split-window -h -c "#{pane_current_path}" と書くと、今いるディレクトリで開く。'],
    split_tb: ['% と " は覚えにくいので、| と - に割り当て直す人が多い（bind | split-window -h など）。'],
    focus: ['prefix → ; で直前の窓に戻る。prefix → o で窓を順に巡る。', 'prefix → q で窓に番号が出る。出ている間に番号を押すと、その窓へ飛ぶ。'],
    zoom: ['全画面のあいだは、ステータスバーのウィンドウ名に Z が付く。窓を移動すると全画面は解ける。'],
    close: ['x は確認付きの kill-pane。y は「本当に閉じる？ (y/n)」への yes。確認を省くなら bind x kill-pane と書く。', 'シェルで exit を打つか C-d を押しても、確認なしでその窓が閉じる。'],
    resize: ['prefix のあと 0.5 秒（repeat-time）以内なら、prefix なしで続けて押せる。Ctrl+矢印は 1 マス、Alt+矢印は 5 マス。', 'set -g mouse on にすると、境目をマウスでドラッグして大きさを変えられる。'],
    new_window: ['c は create。番号は 0 から始まる。set -g base-index 1 で 1 から。'],
    rename: ['ウィンドウ名は、普段は実行中のコマンド名に自動で変わる（automatic-rename）。名前を付けると、その窓では自動で変わらなくなる。'],
    select_window: ['prefix → l で直前のウィンドウへ。prefix → w で一覧から選べる。', "prefix → ' で番号を打って飛べる。10 番以降に便利。"],
    copy: ['prefix → PageUp で、コピーモードに入りながら 1 ページ上へ。', 'コピーモードの方式は mode-keys で決まる。EDITOR か VISUAL に vi が入っていれば vi 式、それ以外は emacs 式。'],
    detach: ['デタッチしてもセッションは裏で動き続ける。SSH が切れても作業は残る。tmux a は tmux attach の略。'],
    swap: ['prefix → C-o で、ウィンドウの窓全部を回転させる（rotate-window）。'],
    layout: ['Alt+1〜5 で並べ方を直接選べる。1 は横に均等、2 は縦に均等、5 が田の字（tiled）。'],
    rename_pane: ['窓の名前は pane-border-status を top にすると、枠の上に出る。'],
    search: ['vi 式は / と ?、emacs 式は C-s と C-r で検索する。n で同じ向きに、N で逆向きに次を探す。'],
    yank: ['tmux の v は「矩形選択の切り替え」で、y には割り当てがない。v と y で選んでコピーするのは vim の流儀。'],
    paste: ['prefix → = で、これまでにコピーしたもの（バッファ）の一覧から選んで貼れる。prefix → # で一覧を見るだけ。'],
    kill_window: ['& も確認付き。ウィンドウの中の窓が全部閉じる。'],
    new_session: ['外からは tmux new -s 名前。中からなら prefix → : で new -s 名前。'],
    rename_session: ['セッションの名前は、外から tmux attach -t 名前 で選ぶときに使う。'],
    choose: ['s はセッションの一覧、w はウィンドウまで含めた一覧（どちらも choose-tree）。( と ) は前後のセッションへ。']
  };

  function tipsFor(action) {
    return TIPS[action] || [];
  }

  // `spell` is what the hero "learns" when the level is cleared.
  // `mp`: chapter 3 levels limit the keys you may press.
  var LEVELS = [
    null,
    {
      title: '縦の壁', icon: 'wall', action: 'split_lr', spell: 'ヨコワリ',
      goal: '窓を左右に分ける',
      story: [
        'ここは tmux の世界。目の前の部屋（ウィンドウ）には、窓（ペイン）がひとつしかない。',
        '壁を一枚立てて、部屋を左右に分けよう。'
      ],
      // Keys shown on the phone key bar.
      keys: ['%']
    },
    {
      title: '地下への階段', icon: 'stairs', action: 'split_tb', spell: 'タテワリ',
      goal: '窓を上下に分ける',
      story: [
        '左右どちらかの床に、地下への階段が隠れている。',
        '窓を上下に分けて、階段を見つけよう。'
      ],
      keys: ['"']
    },
    {
      title: '宝のありか', icon: 'chest', action: 'focus', spell: 'イドウ',
      goal: '宝箱の窓を選ぶ',
      story: [
        'どこかの窓に宝箱が現れた。枠の上に名前が出ている。',
        '窓から窓へ移動して、宝箱のある窓を選ぼう。'
      ],
      keys: []
    },
    {
      title: '望遠鏡', icon: 'scope', action: 'zoom', spell: 'ズーム',
      goal: '窓を全画面にする',
      story: [
        '宝箱の中に望遠鏡があった。',
        'いまの窓を画面いっぱいに広げて、遠くを見てみよう。'
      ],
      keys: ['z']
    },
    {
      title: 'モンスター退治', icon: 'monster', action: 'close', spell: 'トジル',
      goal: 'モンスターの窓を閉じる',
      story: [
        '大変だ、モンスターの窓が現れた！',
        '移動してモンスターの窓を選び、窓ごと閉じて退治しよう。'
      ],
      keys: ['x', 'y']
    },
    {
      title: '陣地を広げる', icon: 'resize', action: 'resize', spell: 'ノビール',
      goal: '窓の大きさを変える',
      story: [
        '戦いで陣地が狭くなった。',
        'いまの窓の大きさを変えて、陣地を広げよう。幅か高さをしっかり変えればいい。'
      ],
      keys: MAC ? ['M-←', 'M-→', 'M-↑', 'M-↓'] : ['C-←', 'C-→', 'C-↑', 'C-↓']
    },
    {
      title: '新しい部屋', icon: 'door', action: 'new_window', spell: 'ヘヤヅクリ',
      goal: '新しいウィンドウを作る',
      story: [
        'この部屋はもう窓でいっぱいだ。',
        '新しい部屋（ウィンドウ）を作ろう。下のステータスバーに部屋の一覧が出ている。'
      ],
      keys: ['c']
    },
    {
      title: '名付け', icon: 'tag', action: 'rename', spell: 'ナヅケ',
      goal: 'ウィンドウ名を camp にする',
      story: [
        '新しい部屋には名前がない。',
        'いまの部屋の名前を camp に変えよう。',
        '入力欄には元の名前が入っている。Ctrl+u か Backspace で消してから打つ。'
      ],
      keys: [',', 'C-u', 'Enter']
    },
    {
      title: '帰り道', icon: 'home', action: 'select_window', spell: 'ルーラ',
      goal: 'home のウィンドウに戻る',
      story: [
        '最初の部屋 home に、忘れ物をしてきた。',
        '部屋を移動して home に戻ろう。'
      ],
      keys: ['n', 'p', '0']
    },
    {
      title: '古文書', icon: 'scroll', action: 'copy', spell: 'サカノボリ',
      goal: '古文書の窓で、コピーモードで一番上まで戻る',
      story: [
        'home の窓のひとつに、長い古文書が現れた。',
        'その窓を選び、コピーモードに入って、一番上まで読み上げよう。',
        'コピーモードでは PageUp か ↑ で上へ。Mac は fn+↑ が PageUp。g で一気に先頭へ。'
      ],
      keys: ['[', 'PgUp', '↑', 'g', 'q']
    },
    {
      title: '旅立ち', icon: 'gate', action: 'detach', spell: 'デタッチ',
      goal: 'デタッチして、tmux attach で戻る',
      story: [
        '村での修行は終わり。tmux のセッションは、画面を閉じても裏で生き続ける。',
        'いったん離脱（デタッチ）して、外の世界から tmux attach と打って戻ってこよう。'
      ],
      keys: ['d']
    },

    // ---- chapter 2: 試練の塔 -------------------------------------------------
    {
      title: '入れ替えの間', icon: 'swap', action: 'swap', spell: 'イレカエ',
      goal: '宝箱の窓を左端まで動かす',
      story: [
        '塔の一階。宝箱の窓が、部屋の右端に置かれている。',
        '移動するのではなく、窓そのものを入れ替えて、宝箱を左端まで運ぼう。'
      ],
      keys: ['{', '}']
    },
    {
      title: '陣形', icon: 'grid', action: 'layout', spell: 'ジンケイ',
      goal: '4 つの窓を田の字（tiled）に並べる',
      story: [
        '縦に積み重なった 4 つの窓。これでは狭くて戦えない。',
        '並べ方（レイアウト）を切り替えて、田の字の陣形を組もう。'
      ],
      keys: ['Space', 'M-5']
    },
    {
      title: '古文書の検索', icon: 'search', action: 'search', spell: 'サガス',
      goal: 'コピーモードで secret を検索する',
      story: [
        '塔の書庫に、300 行の古文書がある。どこかに合言葉が書いてあるらしい。',
        'めくって探すのは遅すぎる。コピーモードの検索で secret という文字を探そう。',
        '? で上向き、/ で下向きに検索。打ったら Enter。'
      ],
      keys: ['[', '?', '/', 'Enter', 'n']
    },
    {
      title: '写本', icon: 'quill', action: 'yank', spell: 'ウツス',
      goal: '合言葉の行を選んでコピーする',
      story: [
        '見つけた！ secret の行に合言葉がある。',
        'その行を選んでコピーしよう。コピーするとコピーモードを抜ける。'
      ],
      keys: ['[', '?', 'Space', 'Enter']
    },
    {
      title: '合言葉の扉', icon: 'lock', action: 'paste', spell: 'ハリツケ',
      goal: '扉の窓に合言葉を貼り付けて Enter',
      story: [
        '書庫の奥に、合言葉でしか開かない扉の窓が現れた。',
        '扉の窓を選び、写した合言葉を貼り付けて Enter を押そう。手で打っても扉は開かない。'
      ],
      keys: [']', 'Enter']
    },
    {
      title: '罠の部屋', icon: 'skull', action: 'kill_window', spell: 'ヘヤケシ',
      goal: '罠の部屋（trap）を丸ごと閉じる',
      story: [
        '扉の先は罠だらけの部屋 trap だった。窓を一枚ずつ閉じていては間に合わない。',
        '部屋（ウィンドウ）ごと閉じてしまおう。'
      ],
      keys: ['&', 'y']
    },
    {
      title: '新しい世界', icon: 'globe', action: 'new_session', spell: 'セカイヅクリ',
      goal: '新しいセッション castle を作る',
      story: [
        '塔の最上階から、魔王の城が見えた。城へ行くには、新しい世界（セッション）が要る。',
        'castle という名前のセッションを作ろう。'
      ],
      keys: [':', 'Enter']
    },
    {
      title: '世界をめぐる', icon: 'compass', action: 'choose', spell: 'ワタリ',
      goal: '元のセッション adv に戻る',
      story: [
        '城へ向かう前に、元の世界 adv に置いてきた荷物を取りに戻ろう。',
        'セッションの一覧を開いて、adv を選ぶ。'
      ],
      keys: ['s', '(', ')', 'Enter']
    },

    // ---- chapter 3: 魔王の城 (MP-limited) -------------------------------------
    {
      title: '三叉の陣', icon: 'fork', action: 'combo', spell: 'サンサ', mp: 10,
      goal: '左に大きな窓、右に上下 2 つの窓を作る',
      story: [
        'ここからは魔王の城。城の中では、押せるキーの数（MP）に限りがある。',
        '空っぽの部屋 fort に、左に大きな窓、右に上下 2 つの窓の陣を組もう。',
        'MP が尽きると、部屋はもとに戻る。キーの説明はもう出ない。'
      ],
      keys: []
    },
    {
      title: '宝の奪還', icon: 'chest', action: 'combo', spell: 'ダッカン', mp: 24,
      goal: '宝箱の窓を左上に移して、全画面にする',
      story: [
        '宝物庫 vault の右下に、奪われた宝箱がある。',
        '宝箱の窓を左上まで運び、全画面で確かめよう。'
      ],
      keys: []
    },
    {
      title: '魔物の群れ', icon: 'monster', action: 'combo', spell: 'ナギハライ', mp: 30,
      goal: 'モンスターの窓を 3 つとも閉じる（仲間の窓は残す）',
      story: [
        '魔物の巣 den。5 つの窓のうち 3 つにモンスターがいる。',
        'モンスターの窓だけを閉じよう。仲間の窓を閉じると、やり直しだ。'
      ],
      keys: []
    },
    {
      title: '魔王の門', icon: 'lock', action: 'combo', spell: 'カイモン', mp: 70,
      goal: '書庫（library）の合言葉を写し、門（gate）の扉を開ける',
      story: [
        '魔王の間の前に、合言葉の門がある。合言葉は別の部屋 library の古文書の中だ。',
        '部屋を行き来して、検索して、写して、貼って、門を開けよう。'
      ],
      keys: []
    },
    {
      title: '魔王', icon: 'crown', action: 'boss', spell: 'ユウシャ',
      goal: '魔王の命令に、時間内に答え続ける',
      story: [
        'ついに魔王が姿を現した！',
        '魔王が命じる操作を、時間内にこなせば攻撃できる。遅れるとダメージを受ける。HP が尽きたらやり直し。',
        'これまでの冒険で覚えた呪文を、指に任せよう。'
      ],
      keys: []
    }
  ];

  function level(n) {
    return LEVELS[n] || null;
  }

  function prefixLabel(prefix) {
    return prefix === 'C-a' ? 'Ctrl+a' : 'Ctrl+b';
  }

  function hint(prefix, action) {
    if (!HINTS[action]) return '';
    if (action === 'yank') return HINTS[action];
    return prefixLabel(prefix) + ' を押して離してから ' + HINTS[action];
  }

  // Cheat sheet rows for the finale: every action taught, once.
  function cheat() {
    var rows = [];
    for (var n = 1; n <= LAST_LEVEL; n++) {
      var lv = level(n);
      if (!HINTS[lv.action]) continue;
      rows.push({ goal: lv.goal, key: HINTS[lv.action], icon: lv.icon, spell: lv.spell });
    }
    return rows;
  }

  // ---- the arena -----------------------------------------------------------------
  // A course is a fixed list of questions, the same every time, so a record
  // can be compared with the last one. Question types live in app.js.
  // `limit` is seconds per question; running out counts as a miss.
  var COURSES = [
    {
      id: 'easy', title: '草原コース', sub: '初級', monster: 'slime', limit: 12,
      desc: '分割・移動・全画面・閉じる・部屋の移動。第 1 章の呪文だけ。',
      qs: ['split_lr', 'focus', 'zoom', 'split_tb', 'close', 'unzoom', 'focus', 'new_window', 'select_window', 'split_lr', 'close', 'focus', 'zoom', 'select_window', 'split_tb']
    },
    {
      id: 'normal', title: '塔コース', sub: '中級', monster: 'bat', limit: 14,
      desc: '大きさ・名前・入れ替え・部屋を閉じる・コピーモードも混ざる。',
      qs: ['focus', 'resize', 'swap', 'rename', 'close', 'kill_window', 'copy_top', 'split_tb', 'swap', 'select_window', 'zoom', 'new_window', 'focus', 'resize', 'kill_window', 'unzoom', 'close', 'split_lr', 'rename', 'focus']
    },
    {
      id: 'hard', title: '城コース', sub: '上級', monster: 'knight', limit: 18,
      desc: '1 問で 2〜3 手の連続技。迷わず手が動くか。',
      qs: ['find_zoom', 'trident', 'two_monsters', 'new_and_home', 'swap_zoom', 'split_lr', 'find_zoom', 'copy_top', 'two_monsters', 'trident', 'kill_window', 'swap_zoom', 'new_and_home', 'focus', 'resize', 'find_zoom']
    }
  ];

  // The final boss asks these, with `limit` seconds each.
  var BOSS = {
    hp: 3, limit: 9,
    qs: ['split_lr', 'find_zoom', 'close', 'swap', 'new_and_home', 'split_tb', 'kill_window', 'trident', 'two_monsters', 'copy_top']
  };

  // Ranks by average seconds per question, after penalties.
  var RANKS = [
    { max: 1.6, title: '伝説の勇者' },
    { max: 2.4, title: '勇者' },
    { max: 3.4, title: '戦士' },
    { max: 5, title: '見習い剣士' },
    { max: Infinity, title: '村人' }
  ];

  function rankFor(avg) {
    for (var i = 0; i < RANKS.length; i++) if (avg <= RANKS[i].max) return RANKS[i].title;
    return RANKS[RANKS.length - 1].title;
  }

  window.ADV = window.ADV || {};
  window.ADV.levels = {
    LAST_LEVEL: LAST_LEVEL,
    LEVELS: LEVELS,
    CHAPTERS: CHAPTERS,
    chapterOf: chapterOf,
    level: level,
    KEYS: KEYS,
    HINTS: HINTS,
    hint: hint,
    cheat: cheat,
    prefixLabel: prefixLabel,
    TIPS: TIPS,
    tipsFor: tipsFor,
    COURSES: COURSES,
    BOSS: BOSS,
    rankFor: rankFor,
    MISS_PENALTY: 2,
    TIMEOUT_PENALTY: 5
  };
})();
