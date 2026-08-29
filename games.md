---
layout: default
title: Games
permalink: /games/

# Each card is generated from this list, so adding a game means adding an entry
# here — no HTML to copy. `rating` is my own recommendation out of 5, based on
# how finished the thing actually is, not on how much work went into it.
#
# Cards render in the order written here, so keep this list highest-rated
# first. Sorting in Liquid was tried and dropped: `sort | reverse` flips the
# order of everything sharing a rating, which shuffled the four-star three.
games:
  - name: World Express
    img: /assets/games/world-express.jpg
    url: /world-express/
    source: https://github.com/t29mato/world-express
    rating: 4
    tags: [Board game, Trivia]
    blurb: >-
      Roll dice along real railway maps across forty-seven boards, buy businesses
      in real towns, and learn something true about every stop.
    note: English, Spanish, French and Japanese. Installs to a phone and plays offline.

  - name: Life Journey
    img: /assets/games/life-journey.jpg
    url: /life-game/
    source: https://github.com/t29mato/life-game
    rating: 4
    tags: [Board game, Party]
    blurb: >-
      Spin your way through a whole life — college or a first job, careers,
      marriage, a house, and a retirement you hope you can afford.
    note: Five country editions. Two to four players around one screen, or against the computer.

  - name: Order of Magnitude
    img: /assets/games/order-of-magnitude.jpg
    url: https://order-of-magnitude.vercel.app
    rating: 4
    tags: [Tower defense, Strategy]
    blurb: >-
      Hold the line for twenty waves a sector. Place ordnance, upgrade it between
      waves, and brace for the Titan at the end.
    note: Twelve sectors, drawn like a field manual.

  - name: Bomb Rush
    img: /assets/games/bomb-rush.jpg
    url: /experiments/bomb-rush/
    rating: 3
    tags: [Arcade, Action]
    blurb: >-
      Drop bombs to smash crates and wipe out every enemy, then find the exit
      hidden underneath. Your own blast hurts you too.
    note: Keyboard arcade action, one screen per stage.

  - name: World Tour Surf
    img: /assets/games/world-tour-surf.jpg
    url: /experiments/ct-surf-tour/
    rating: 3
    tags: [Sports, Career]
    blurb: >-
      Paddle into world-class lineups and ride the set waves, with five judges
      scoring every manoeuvre.
    note: Two tours, from the qualifying grind to the championship.

  - name: Yumimoto Ladder
    img: /assets/games/yumimoto-ladder.jpg
    url: /experiments/yumimoto-ladder/
    rating: 3
    tags: [Word game, Learning]
    blurb: >-
      Climb the corporate ladder of *Fear and Trembling* one English word at a
      time. Four choices, and wrong cards come back.
    note: Sixty words across five decks.

  - name: Tokyo Neon
    img: /assets/games/tokyo-neon.jpg
    url: https://neon-city-psi-livid.vercel.app
    rating: 2
    tags: [Open world, 3D action]
    blurb: >-
      Steal a car and tear through the back streets of a procedurally generated
      Tokyo at night.
    note: An early build — the city is there, the missions are not.
---

## 🎮 Games

<p class="page-intro" markdown="1">
Small self-contained browser games and toys, built for fun. Each one runs entirely
client-side — just open and play. **The stars are my own recommendation** out of five:
how finished and worth-your-evening the thing actually is, not how much work went in.
</p>

{% include showcase.html items=page.games action="Play" %}
