// Pixel art for tmux打, drawn as SVG rects from tiny bitmaps.
// One visual vocabulary for the map, the quest band, the briefing and the panes.
(function () {
  'use strict';

  // 8x8 icons. '#' is the ink colour, '.' is empty.
  var ICONS = {
    wall: [
      '########',
      '#..##..#',
      '#..##..#',
      '#..##..#',
      '#..##..#',
      '#..##..#',
      '#..##..#',
      '########'
    ],
    stairs: [
      '########',
      '#......#',
      '#......#',
      '########',
      '########',
      '#......#',
      '#......#',
      '########'
    ],
    chest: [
      '..####..',
      '.#....#.',
      '########',
      '#..##..#',
      '#.####.#',
      '#..##..#',
      '#......#',
      '########'
    ],
    scope: [
      '......##',
      '.....##.',
      '....##..',
      '...###..',
      '..####..',
      '.##.#...',
      '##..#...',
      '....###.'
    ],
    monster: [
      '.#....#.',
      '..####..',
      '.######.',
      '##.##.##',
      '########',
      '#.####.#',
      '.######.',
      '.#.##.#.'
    ],
    resize: [
      '#......#',
      '##....##',
      '#.#..#.#',
      '...##...',
      '...##...',
      '#.#..#.#',
      '##....##',
      '#......#'
    ],
    door: [
      '...##...',
      '...##...',
      '...##...',
      '########',
      '########',
      '...##...',
      '...##...',
      '...##...'
    ],
    tag: [
      '.....###',
      '....#..#',
      '...#...#',
      '..#...#.',
      '.#...#..',
      '#...#...',
      '##.#....',
      '.##.....'
    ],
    home: [
      '...##...',
      '..####..',
      '.######.',
      '########',
      '.######.',
      '.##..##.',
      '.##..##.',
      '.######.'
    ],
    scroll: [
      '.######.',
      '#.####.#',
      '.######.',
      '..#..#..',
      '..####..',
      '..####..',
      '.#....#.',
      '.######.'
    ],
    gate: [
      '..####..',
      '.######.',
      '##....##',
      '##....##',
      '##....##',
      '##..#.##',
      '##....##',
      '##....##'
    ],
    star: [
      '...##...',
      '...##...',
      '.######.',
      '########',
      '########',
      '.######.',
      '..#..#..',
      '.#....#.'
    ],
    key: [
      '..####..',
      '.#....#.',
      '.#....#.',
      '..####..',
      '...##...',
      '...##...',
      '...###..',
      '...##...'
    ],
    swap: [
      '..#.....',
      '.##.....',
      '########',
      '.##.....',
      '.....##.',
      '########',
      '.....##.',
      '.....#..'
    ],
    grid: [
      '########',
      '#..##..#',
      '#..##..#',
      '########',
      '########',
      '#..##..#',
      '#..##..#',
      '########'
    ],
    search: [
      '.####...',
      '#....#..',
      '#....#..',
      '#....#..',
      '.####...',
      '....##..',
      '.....##.',
      '......##'
    ],
    quill: [
      '......##',
      '.....###',
      '....###.',
      '...###..',
      '..###...',
      '..##....',
      '.#......',
      '#.......'
    ],
    lock: [
      '..####..',
      '.#....#.',
      '.#....#.',
      '########',
      '###..###',
      '###..###',
      '####.###',
      '########'
    ],
    skull: [
      '.######.',
      '########',
      '#..##..#',
      '#..##..#',
      '########',
      '.##..##.',
      '.######.',
      '.#.##.#.'
    ],
    globe: [
      '..####..',
      '.#.##.#.',
      '#..##..#',
      '########',
      '#..##..#',
      '#..##..#',
      '.#.##.#.',
      '..####..'
    ],
    compass: [
      '..####..',
      '.#.##.#.',
      '#..##..#',
      '#.####.#',
      '#.####.#',
      '#..##..#',
      '.#.##.#.',
      '..####..'
    ],
    fork: [
      '#..#..#.',
      '#..#..#.',
      '#..#..#.',
      '#######.',
      '...#....',
      '...#....',
      '...#....',
      '..###...'
    ],
    crown: [
      '#..##..#',
      '#..##..#',
      '##.##.##',
      '########',
      '########',
      '#.#..#.#',
      '########',
      '........'
    ]
  };

  // Multi-colour sprites. Letters map to CSS custom properties on the
  // host, so the same sprite recolours per theme.
  var SPRITES = {
    treasure: {
      palette: { B: 'var(--spr-wood)', Y: 'var(--spr-gold)', K: 'var(--spr-ink)', G: 'var(--spr-glow)', W: 'var(--spr-light)' },
      rows: [
        '....BBBBBBBB....',
        '..BBYYYYYYYYBB..',
        '.BYYBBBBBBBBYYB.',
        '.BYBBBBBBBBBBYB.',
        'BYBBBBWBBBBBBBYB',
        'BYYYYYYYYYYYYYYB',
        'BYBBBBBKKBBBBBYB',
        'BYBBBBBKYKBBBBYB',
        'BYBBBBBKKBBBBBYB',
        'BYBBBBBBBBBBBBYB',
        '.BYYYYYYYYYYYYB.',
        '..BBBBBBBBBBBB..'
      ]
    },
    monster: {
      palette: { P: 'var(--spr-body)', W: 'var(--spr-light)', K: 'var(--spr-ink)', R: 'var(--spr-maw)', D: 'var(--spr-dark)' },
      rows: [
        '.P............P.',
        '.PP..........PP.',
        '.PPP.PPPPPP.PPP.',
        '.PPPPPPPPPPPPPP.',
        '.PPPWWPPPPWWPPP.',
        'PPPPWKPPPPKWPPPP',
        'PPPPPPPPPPPPPPPP',
        'PPPPRRRRRRRRPPPP',
        'PPPPRWRRRRWRPPPP',
        '.PPPPRRRRRRPPPP.',
        '.PPPPPPPPPPPPPP.',
        '..DD.DD..DD.DD..'
      ]
    },
    telescope: {
      palette: { B: 'var(--spr-wood)', Y: 'var(--spr-gold)', K: 'var(--spr-ink)', L: 'var(--spr-light)' },
      rows: [
        '............YYY.',
        '...........YLLY.',
        '..........YLLLY.',
        '.........BBYYY..',
        '........BBB.....',
        '.......BBB......',
        '......BBB.......',
        '.....BBB........',
        '....YBB.........',
        '...YKY..........',
        '..YKKKY.........',
        '.YKKKKKY........'
      ]
    },
    stairs: {
      palette: { S: 'var(--spr-stone)', D: 'var(--spr-dark)', K: 'var(--spr-ink)' },
      rows: [
        'SSSSSSSSSSSSSSSS',
        'SKKKKKKKKKKKKKKS',
        'SKKSSSSSSSSSSKKS',
        'SKKSDDDDDDDDSKKS',
        'SKKSDSSSSSSDSKKS',
        'SKKSDSKKKKSDSKKS',
        'SKKSDSKSSKSDSKKS',
        'SKKSDSKSSKSDSKKS',
        'SKKSDSKKKKSDSKKS',
        'SKKSDSSSSSSDSKKS',
        'SKKSDDDDDDDDSKKS',
        'SSSSSSSSSSSSSSSS'
      ]
    },
    trophy: {
      palette: { Y: 'var(--spr-gold)', L: 'var(--spr-light)', B: 'var(--spr-wood)', D: 'var(--spr-dark)' },
      rows: [
        'YYYYYYYYYYYYYYYY',
        'Y.YLLYYYYYYLY..Y',
        'Y.YLYYYYYYYYY..Y',
        'YY.YYYYYYYYYY.YY',
        '.YYYYYYYYYYYYYY.',
        '...YYYYYYYYYY...',
        '....YYYYYYYY....',
        '......YYYY......',
        '.......YY.......',
        '......YYYY......',
        '....BBBBBBBB....',
        '...DDDDDDDDDD...'
      ]
    },
    ally: {
      palette: { S: 'var(--spr-skin)', B: 'var(--spr-ally)', K: 'var(--spr-ink)', W: 'var(--spr-light)', Y: 'var(--spr-gold)' },
      rows: [
        '.....YYYYYY.....',
        '....YYYYYYYY....',
        '....SSSSSSSS....',
        '....SKSSSSKS....',
        '....SSSSSSSS....',
        '.....SSWWSS.....',
        '...BBBBBBBBBB...',
        '..BBBBYBBYBBBB..',
        '..SBBBBBBBBBBS..',
        '..SBBBBBBBBBBS..',
        '....BBB..BBB....',
        '....KKK..KKK....'
      ]
    },
    door: {
      palette: { B: 'var(--spr-wood)', S: 'var(--spr-stone)', K: 'var(--spr-ink)', Y: 'var(--spr-gold)' },
      rows: [
        '....SSSSSSSS....',
        '...SSBBBBBBSS...',
        '..SSBBBBBBBBSS..',
        '..SBBBKBBKBBBS..',
        '..SBBBKBBKBBBS..',
        '..SBBBKBBKBBBS..',
        '..SBBBBBBBBYBS..',
        '..SBBBKBBKBYBS..',
        '..SBBBKBBKBBBS..',
        '..SBBBKBBKBBBS..',
        '..SBBBBBBBBBBS..',
        '.SSSSSSSSSSSSSS.'
      ]
    },
    door_open: {
      palette: { B: 'var(--spr-wood)', S: 'var(--spr-stone)', K: 'var(--spr-ink)', G: 'var(--spr-glow)' },
      rows: [
        '....SSSSSSSS....',
        '...SSGGGGGGSS...',
        '..SSGGGGGGGGSS..',
        '..SBGGGGGGGGGS..',
        '..SBBGGGGGGGGS..',
        '..SBBGGGGGGGGS..',
        '..SBBGGGGGGGGS..',
        '..SBBGGGGGGGGS..',
        '..SBBGGGGGGGGS..',
        '..SBBGGGGGGGGS..',
        '..SBGGGGGGGGGS..',
        '.SSSSSSSSSSSSSS.'
      ]
    },
    hero: {
      palette: { A: 'var(--spr-stone)', B: 'var(--spr-ally)', D: 'var(--spr-wood)', H: 'var(--spr-hair)', K: 'var(--spr-ink)', L: 'var(--spr-steel)', M: 'var(--spr-maw)', R: 'var(--spr-cape)', S: 'var(--spr-skin)', W: 'var(--spr-light)', Y: 'var(--spr-gold)' },
      rows: [
        '........................',
        '..........KKKK..........',
        '........KKHHHHKK........',
        '.......KHHHHHHHHK.......',
        '......KHHHHHHHHHHK..KK..',
        '......KYYYYYYYYYYK.KWLK.',
        '.....KHHSSSSSSSSHHKKWLK.',
        '.....KHHSWKSSWKSHHKKWLK.',
        '......KHSKKSSKKSHK.KWLK.',
        '......KHSSSSSSSSHK.KWLK.',
        '.......KSSSMMSSSK..KWLK.',
        '.....KKKKYYYYYYKKK.KWLK.',
        '....KRRBBBBBBBBBBRKKWLK.',
        '...KAARBBBBYYBBBBBBKWLK.',
        '...KAAABBBBYYBBBBBBKWK..',
        '...KAYABBBBYYBBBBBSYYYK.',
        '...KAAABBBBBBBBBBRSSDK..',
        '...KAAAYYYYYYYYYYRKKDK..',
        '....KRRBBBBBBBBBBRK.K...',
        '....KRRRBBBKKBBBKK......',
        '.....KKKBBBKKBBBK.......',
        '......KDDDDKKDDDDK......',
        '......KDDDDKKDDDDK......',
        '.......KKKK..KKKK.......'
      ]
    },
    hero_cast: {
      palette: { A: 'var(--spr-stone)', B: 'var(--spr-ally)', D: 'var(--spr-wood)', G: 'var(--spr-glow)', H: 'var(--spr-hair)', K: 'var(--spr-ink)', L: 'var(--spr-steel)', M: 'var(--spr-maw)', R: 'var(--spr-cape)', S: 'var(--spr-skin)', W: 'var(--spr-light)', Y: 'var(--spr-gold)' },
      rows: [
        '................GKWK....',
        '..........KKKK...KWLKG..',
        '........KKHHHHGK.KWLK...',
        '.......KHHHHHHHHKKWLK.G.',
        '......KHHHHHHHHHHKWLK...',
        '......KYYYYYYYYYYKWLKG..',
        '.....KHHSSSSSSSSHYYYK...',
        '.....KHHSWKSSWKSHSDK....',
        '......KHSKKSSKKSHSSK....',
        '......KHSSSSSSSSBBK.....',
        '.......KSSSMMSSSBBK.....',
        '.....KKKKYYYYYYKBBK.....',
        '....KRRBBBBBBBBBBBK.....',
        '....KRRBBBBYYBBBBRK.....',
        '...KAAABBBBYYBBBBRK.....',
        '...KAYABBBBYYBBBBRK.....',
        '...KAAABBBBBBBBBBRK.....',
        '...KAAAYYYYYYYYYYRK.....',
        '....KRRBBBBBBBBBBRK.....',
        '....KRRRBBBKKBBBKK......',
        '.....KKKBBBKKBBBK.......',
        '......KDDDDKKDDDDK......',
        '......KDDDDKKDDDDK......',
        '.......KKKK..KKKK.......'
      ]
    },
    hero_win: {
      palette: { B: 'var(--spr-ally)', D: 'var(--spr-wood)', H: 'var(--spr-hair)', K: 'var(--spr-ink)', L: 'var(--spr-steel)', M: 'var(--spr-maw)', R: 'var(--spr-cape)', S: 'var(--spr-skin)', W: 'var(--spr-light)', Y: 'var(--spr-gold)' },
      rows: [
        '.................KWK....',
        '..........KKKK...KWLK...',
        '........KKHHHHKK.KWLK...',
        '.......KHHHHHHHHKKWLK...',
        '......KHHHHHHHHHHKWLK...',
        '......KYYYYYYYYYYKWLK...',
        '.....KHHSSSSSSSSHYYYK...',
        '....KSSHSWKSSWKSHSSK....',
        '....KSSHSKKSSKKSHSSK....',
        '.....KBBSSMMMMSSBBK.....',
        '.....KBBSSSMMSSSBBK.....',
        '.....KBBKYYYYYYKBBK.....',
        '....KRBBBBBBBBBBBBK.....',
        '....KRRBBBBYYBBBBRK.....',
        '....KRRBBBBYYBBBBRK.....',
        '....KRRBBBBYYBBBBRK.....',
        '....KRRBBBBBBBBBBRK.....',
        '....KRRYYYYYYYYYYRK.....',
        '....KRRBBBBBBBBBBRK.....',
        '....KRRRBBBKKBBBKK......',
        '.....KKKBBBKKBBBK.......',
        '......KDDDDKKDDDDK......',
        '......KDDDDKKDDDDK......',
        '.......KKKK..KKKK.......'
      ]
    },
    elder: {
      palette: { D: 'var(--spr-wood)', G: 'var(--spr-glow)', K: 'var(--spr-ink)', P: 'var(--spr-body)', S: 'var(--spr-skin)', W: 'var(--spr-light)', Y: 'var(--spr-gold)' },
      rows: [
        '........KKKKKKKK........',
        '.......KPPPPPPPPK.KKK...',
        '......KPPPPPPPPPPKYYYK..',
        '.....KPPPPPPPPPPPPYGYK..',
        '......KPPPPPPPPPPKYYYK..',
        '......KSPPPPPPPPSKKDK...',
        '......KSSWWSSWWSSKKDK...',
        '......KSSSKSSKSSSKKDK...',
        '......KSSWWWWWWSSKKDK...',
        '.......KSWWWWWWSK.KDK...',
        '.......KWWWWWWWWK.KDK...',
        '......KKWWWWWWWWKKKDK...',
        '.....KPPWWWWWWWWPPKDK...',
        '.....KPPWWWWWWWWPSSDK...',
        '.....KPPPWWWWWWPPSSDK...',
        '.....KPPPWWWWWWPPPKDK...',
        '....KPPPPPPYYPPPPPPDK...',
        '....KPPPPPPYYPPPPPPDK...',
        '....KPPPPPPYYPPPPPPDK...',
        '....KPPPPPPYYPPPPPPDK...',
        '....KPPPPPPYYPPPPPPDK...',
        '....KPPPPPPYYPPPPPPDK...',
        '....KPPPPPPYYPPPPPPDK...',
        '.....KKKKKKKKKKKKKKK....'
      ]
    },
    slime: {
      palette: { B: 'var(--spr-slime)', D: 'var(--spr-slime-d)', K: 'var(--spr-ink)', L: 'var(--spr-light)' },
      rows: [
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '........................',
        '..........KKKK.KKK......',
        '......KK.KBBBBKBBBK.....',
        '.....KBBKBBBBBBBBBBK....',
        '....KBLLBBBBBBBBBLBBK...',
        '...KBBLLBBBBBBBBBBBBK...',
        '...KBBLLBBBBBBBBBBBBK...',
        '..KBBBBBBBBBBBBBBBBBBK..',
        '.KBBBBBBBBBBBBBBBBBBBBK.',
        '.KBBBBBBBKBBBBKBBBBBBBK.',
        '.KBBBBBBBKBBBBKBBBBBBBK.',
        '.KBBBLBBBBBBBBBBBBBBBBK.',
        '..KBBBBBBBBKKBBBBBBBBK..',
        '...KBBBBBBBBBBBBBBBBK...',
        '..KDDDDDDDDDDDDDDDDDDK..',
        '...KDKKBBBBDBBBBBKKDK...',
        '....K..KKKKKKKKKK..K....'
      ]
    },
    bat: {
      palette: { K: 'var(--spr-ink)', M: 'var(--spr-maw)', P: 'var(--spr-bat)', W: 'var(--spr-light)', Y: 'var(--spr-gold)' },
      rows: [
        '........................',
        '........................',
        '........................',
        '........................',
        'K......................K',
        'PKK..................KKP',
        'PPPK......K..K......KPPP',
        'PPPKK....KPKKPK....KKPPP',
        'PPPPPKK..KPKKPK..KKPPPPP',
        'PPPPPPPKKKPPPPKKKPPPPPPP',
        'PPPPPPPPPPPPPPPPPPPPPPPP',
        'KPPPPPPPPPYPPYPPPPPPPPPK',
        'KPPKPPPPPPYPPYPPPPPPKPPK',
        'KPPKPPKPPPPPPPPPPKPPKPPK',
        '.KK.KPKPPPPPPPPPPKPK.KK.',
        '.....K.KKPPMMPPKK.K.....',
        '.........KPWWPK.........',
        '..........KKKK..........',
        '.........KPKKPK.........',
        '.........KPKKPK.........',
        '..........K..K..........',
        '........................',
        '........................',
        '........................'
      ]
    },
    knight: {
      palette: { A: 'var(--spr-stone)', D: 'var(--spr-dark)', K: 'var(--spr-ink)', M: 'var(--spr-maw)', W: 'var(--spr-light)', Y: 'var(--spr-gold)' },
      rows: [
        '..........KMMK..........',
        '..........KMMK..........',
        '........KKAMMAKK....K...',
        '.......KAAAAAAAAK..KWK..',
        '.......KAAAAAAAAK..KWK..',
        '......KAAAAAAAAAAK.KWK..',
        '......KAKKMKKMKKAK.KWK..',
        '......KAKKKKKKKKAK.KWK..',
        '......KAAAAAAAAAAK.KWK..',
        '.......KAAAAAAAAK..KWK..',
        '.......KAAAAAAAAK..KWK..',
        '....KKKKKKAAAAKKKKKKWK..',
        '..KKDDDAAAAAAAAAADDDWK..',
        '.KAAAADAAAAAAAAAADDDWK..',
        '.KAAAADAAAYYYYAAADDDWK..',
        '.KAMMADAAAYYYYAAADDYYYK.',
        '.KAMMADAAAAAAAAAADDDDK..',
        '.KAAAADAAAAAAAAAADDDDK..',
        '.KAAAADAAAAAAAAAADDDDK..',
        '..KKKKKAAAAAAAAAAKKKK...',
        '.......KDDDKKDDDK.......',
        '.......KDDDKKDDDK.......',
        '.......KDDDKKDDDK.......',
        '........KKK..KKK........'
      ]
    },
    boss: {
      palette: { D: 'var(--spr-dark)', G: 'var(--spr-glow)', K: 'var(--spr-ink)', M: 'var(--spr-maw)', P: 'var(--spr-body)', W: 'var(--spr-light)', Y: 'var(--spr-gold)' },
      rows: [
        '........KYK.KYKKYKKYKKYK........',
        '........KYK.KYKKYKKYKKYK........',
        '........KYKKKYKKYKKYKKYK........',
        '........KYYYYYYYYYYYYYYK........',
        '........KYYYGYYYMYYYGYYK........',
        '.....K..KYYYYYYYYYYYYYYK..K.....',
        '....KWKK.KKKPPPPPPPPKKK.KKWK....',
        '.....KWWK.KPPPPPPPPPPK.KWWK.....',
        '.....KWWKKPPPPPPPPPPPPKKWWK.....',
        '.....KWWKPPPPPPPPPPPPPPKWWK.....',
        '......KKKPPYKYPPPPYKYPPKKK......',
        '........KPPYYYPPPPYYYPPK........',
        '........KPPPPPPPPPPPPPPK........',
        '....K...KPPPPPPPPPPPPPPK...K....',
        '...KDK..KPPPPPPPPPPPPPPK..KDK...',
        '...KDKKKKKPMWMWMMWMWMPKKKKKDK...',
        '..KDDKDDDDDMMMMMMMMMMDDDDDKDDK..',
        '..KDDKDDDDDMMMMMMMMMMDDDDDKDDK..',
        '.KDDDKDDDDDDDPPPPPPDDDDDDDKDDDK.',
        '.KDDDKDDDDDDDDDDDDDDDDDDDDKDDDK.',
        '.KDDDKDDDDYYYYYYYYYYYYDDDDKDDDK.',
        '.KDDDKDDDDYYYYYYYYYYYYDDDDKDDDK.',
        '.KPPPDDDDDDDDDDYYDDDDDDDDDDPPPK.',
        '.KPPPDDDDDDDDMMMMMMDDDDDDDDPPPK.',
        '.KPPPDDDDDDDDDDYYDDDDDDDDDDPPPK.',
        '.KDDDDDDDDDDDDDYYDDDDDDDDDDDDDK.',
        '.KDDDDDDDDDDDDDYYDDDDDDDDDDDDDK.',
        '.KDDDDDDDDDDDDDYYDDDDDDDDDDDDDK.',
        '.KDDDDDDDDDDDDDDDDDDDDDDDDDDDDK.',
        '.KDDDDDDDDDDDDDDDDDDDDDDDDDDDDK.',
        '..KKKKKKKKKKKKKKKKKKKKKKKKKKKK..',
        '................................'
      ]
    }
  };

  function iconSVG(name, cls) {
    var rows = ICONS[name];
    if (!rows) return '';
    var out = '<svg class="px ' + (cls || '') + '" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges">';
    for (var y = 0; y < rows.length; y++) {
      for (var x = 0; x < rows[y].length; x++) {
        if (rows[y][x] === '#') out += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
      }
    }
    return out + '</svg>';
  }

  function spriteSVG(name, cls) {
    var s = SPRITES[name];
    if (!s) return '';
    var w = s.rows[0].length, h = s.rows.length;
    var out = '<svg class="spr spr-' + name + ' ' + (cls || '') + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" shape-rendering="crispEdges">';
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var c = s.rows[y][x];
        if (c !== '.') out += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + s.palette[c] + '"/>';
      }
    }
    return out + '</svg>';
  }

  // The world map: 24 stations in three regions, the village along the
  // bottom, the tower on the left, the castle at the top right.
  var STATIONS = [
    null,
    [30, 312], [78, 296], [126, 314], [174, 296], [222, 314], [270, 296], [318, 314], [372, 300],
    [372, 252], [318, 240], [264, 254],
    [208, 236], [156, 226], [104, 214], [52, 198], [44, 150], [94, 140], [146, 150], [198, 136],
    [252, 124], [304, 108], [352, 86], [324, 50], [262, 40]
  ];

  function worldMap(level, lastLevel, levels, chapters) {
    var w = 410, h = 340;
    var out = '<svg class="map" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="24 の試練の地図">';
    out += '<g class="map-terrain">';
    out += '<path d="M0 340 Q60 316 120 330 T250 332 T410 326 L410 340 Z"/>';
    // the tower
    out += '<path d="M18 228 h20 v-58 l-10 -14 l-10 14 z"/>';
    // the castle
    out += '<path d="M200 74 h14 v-14 h8 v8 h8 v-8 h8 v14 h14 v-22 h6 v-10 h-6 v-6 h-12 v6 h-6 v10 h-6 v-8 h-8 v8 h-6 v10 h-6 z"/>';
    out += '<path d="M330 200 l20 -26 l20 26 z M352 208 l14 -18 l14 18 z"/>';
    out += '</g>';
    var d = '';
    for (var i = 1; i <= lastLevel; i++) d += (i === 1 ? 'M' : 'L') + STATIONS[i][0] + ' ' + STATIONS[i][1] + ' ';
    out += '<path class="map-road" d="' + d + '"/>';
    var cleared = '';
    for (var j = 1; j < Math.min(level, lastLevel + 1); j++) cleared += (j === 1 ? 'M' : 'L') + STATIONS[j][0] + ' ' + STATIONS[j][1] + ' ';
    if (level > 1) out += '<path class="map-road done" d="' + cleared + '"/>';
    (chapters || []).forEach(function (c, k) {
      var at = [[16, 262], [16, 116], [276, 22]][k];
      var state = level > c.last ? ' done' : level >= c.first ? ' now' : '';
      out += '<text class="map-chapter' + state + '" x="' + at[0] + '" y="' + at[1] + '">第' + c.n + '章 ' + c.title + '</text>';
    });
    for (var n = 1; n <= lastLevel; n++) {
      var s = STATIONS[n];
      var st = n < level ? 'done' : (n === level ? 'now' : 'todo');
      out += '<g class="map-node ' + st + '" transform="translate(' + s[0] + ' ' + s[1] + ')">';
      out += '<title>' + n + ' ' + levels[n].title + '</title>';
      out += '<circle r="12"/>';
      out += '<g transform="translate(-6.4 -6.4) scale(1.6)">' + iconInner(levels[n].icon) + '</g>';
      if (st === 'now') {
        // The hero stands on the current station.
        out += '<g class="map-hero" transform="translate(-12 -40)">' + spriteInner('hero') + '</g>';
        out += '<text class="map-label" y="26" text-anchor="middle">' + n + ' ' + levels[n].title + '</text>';
      }
      out += '</g>';
    }
    out += '</svg>';
    return out;
  }

  function spriteInner(name) {
    var sp = SPRITES[name];
    var out = '';
    for (var y = 0; y < sp.rows.length; y++) {
      for (var x = 0; x < sp.rows[y].length; x++) {
        var c = sp.rows[y][x];
        // An inline style, so the map's own rect colours cannot override it.
        if (c !== '.') out += '<rect x="' + x + '" y="' + y + '" width="1" height="1" style="fill:' + sp.palette[c] + '"/>';
      }
    }
    return out;
  }

  function iconInner(name) {
    var rows = ICONS[name];
    var out = '';
    for (var y = 0; y < rows.length; y++) {
      for (var x = 0; x < rows[y].length; x++) {
        if (rows[y][x] === '#') out += '<rect x="' + x + '" y="' + y + '" width="1" height="1"/>';
      }
    }
    return out;
  }

  window.ADV = window.ADV || {};
  window.ADV.art = { icon: iconSVG, sprite: spriteSVG, worldMap: worldMap, ICONS: ICONS };
})();
