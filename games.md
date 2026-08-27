---
layout: default
title: Games
permalink: /games/

# Each card is generated from this list, so adding a game means adding an entry
# here — no HTML to copy. `rating` is my own recommendation out of 5, based on
# how finished the thing actually is, not on how much work went into it.
# Cards are shown highest-rated first.
games:
  - name: Grand Express
    slug: grand-express
    url: /grand-express/
    source: https://github.com/t29mato/grand-express
    rating: 4
    tags: [Board game, Trivia]
    blurb: >-
      Roll dice along real railway maps across forty-seven boards, buy businesses
      in real towns, and learn something true about every stop.
    note: English, Spanish, French and Japanese. Installs to a phone and plays offline.

  - name: Life Journey
    slug: life-journey
    url: /life-game/
    source: https://github.com/t29mato/life-game
    rating: 4
    tags: [Board game, Party]
    blurb: >-
      Spin your way through a whole life — college or a first job, careers,
      marriage, a house, and a retirement you hope you can afford.
    note: Five country editions. Two to four players around one screen, or against the computer.

  - name: Order of Magnitude
    slug: order-of-magnitude
    url: https://order-of-magnitude.vercel.app
    rating: 4
    tags: [Tower defense, Strategy]
    blurb: >-
      Hold the line for twenty waves a sector. Place ordnance, upgrade it between
      waves, and brace for the Titan at the end.
    note: Twelve sectors, drawn like a field manual.

  - name: Bomb Rush
    slug: bomb-rush
    url: /experiments/bomb-rush/
    rating: 3
    tags: [Arcade, Action]
    blurb: >-
      Drop bombs to smash crates and wipe out every enemy, then find the exit
      hidden underneath. Your own blast hurts you too.
    note: Keyboard arcade action, one screen per stage.

  - name: World Tour Surf
    slug: world-tour-surf
    url: /experiments/ct-surf-tour/
    rating: 3
    tags: [Sports, Career]
    blurb: >-
      Paddle into world-class lineups and ride the set waves, with five judges
      scoring every manoeuvre.
    note: Two tours, from the qualifying grind to the championship.

  - name: Yumimoto Ladder
    slug: yumimoto-ladder
    url: /experiments/yumimoto-ladder/
    rating: 3
    tags: [Word game, Learning]
    blurb: >-
      Climb the corporate ladder of *Fear and Trembling* one English word at a
      time. Four choices, and wrong cards come back.
    note: Sixty words across five decks.

  - name: Tokyo Neon
    slug: tokyo-neon
    url: https://neon-city-psi-livid.vercel.app
    rating: 2
    tags: [Open world, 3D action]
    blurb: >-
      Steal a car and tear through the back streets of a procedurally generated
      Tokyo at night.
    note: An early build — the city is there, the missions are not.
---

<style>
.games-intro { max-width: 46rem; }

.game-grid {
  display: grid;
  /* Cards find their own column count. Below ~640px this collapses to one
     column on its own, so there is no breakpoint to keep in sync. */
  grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
  gap: 1.75rem;
  margin: 2rem 0 3rem;
  padding: 0;
  list-style: none;
}

.game-card {
  display: flex;
  flex-direction: column;
  border: 1px solid #e2e2e2;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.game-card:hover,
.game-card:focus-within {
  transform: translateY(-2px);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.12);
}

/* The picture carries the "what kind of game is this" job, so it gets a fixed
   shape and never letterboxes — the images are all 1200x750. */
.game-shot {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  background: #11151c;
  border-bottom: 1px solid #e8e8e8;
}

.game-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 1.1rem 1.2rem;
  flex: 1;
}

.game-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.game-title { font-size: 1.15rem; font-weight: 700; line-height: 1.2; }
.game-title a { text-decoration: none; }
.game-title a:hover { text-decoration: underline; }

.game-stars { color: #e0a800; letter-spacing: 0.08em; font-size: 0.95rem; white-space: nowrap; }

.game-tags { display: flex; flex-wrap: wrap; gap: 0.35rem; }

.game-tag {
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.18rem 0.5rem;
  border-radius: 999px;
  background: #eef1f5;
  color: #48525f;
  white-space: nowrap;
}

.game-blurb { font-size: 0.92rem; line-height: 1.5; margin: 0; }
.game-note { font-size: 0.8rem; color: #6b7480; margin: 0; }

.game-links {
  margin-top: auto;
  padding-top: 0.6rem;
  display: flex;
  gap: 0.9rem;
  font-size: 0.85rem;
}

@media (prefers-color-scheme: dark) {
  .game-card { background: #1b1f26; border-color: #2c323c; }
  .game-shot { border-bottom-color: #2c323c; }
  .game-tag { background: #263040; color: #b9c4d2; }
  .game-note { color: #97a2b0; }
}
</style>

## 🎮 Games

<p class="games-intro" markdown="1">
Small self-contained browser games and toys, built for fun. Each one runs entirely
client-side — just open and play. **The stars are my own recommendation** out of five:
how finished and worth-your-evening the thing actually is, not how much work went in.
</p>

<ul class="game-grid">
{% assign ranked = page.games | sort: "rating" | reverse %}
{% for game in ranked %}
  <li class="game-card">
    <a href="{{ game.url }}" tabindex="-1" aria-hidden="true">
      <img class="game-shot" src="/assets/games/{{ game.slug }}.jpg" alt="" loading="lazy" width="1200" height="750">
    </a>
    <div class="game-body">
      <div class="game-head">
        <span class="game-title"><a href="{{ game.url }}">{{ game.name }}</a></span>
        <span class="game-stars" title="{{ game.rating }} out of 5" aria-label="Rated {{ game.rating }} out of 5">
          {%- for i in (1..5) -%}{%- if i <= game.rating -%}★{%- else -%}☆{%- endif -%}{%- endfor -%}
        </span>
      </div>
      <div class="game-tags">
        {% for tag in game.tags %}<span class="game-tag">{{ tag }}</span>{% endfor %}
      </div>
      <p class="game-blurb">{{ game.blurb | markdownify | remove: "<p>" | remove: "</p>" }}</p>
      <p class="game-note">{{ game.note }}</p>
      <div class="game-links">
        <a href="{{ game.url }}">Play</a>
        {% if game.source %}<a href="{{ game.source }}">Source</a>{% endif %}
      </div>
    </div>
  </li>
{% endfor %}
</ul>
