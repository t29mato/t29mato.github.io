---
layout: post
title: "Reconstructing a Near-Drowning at Kashima-nada with Claude Opus 5 and Claude Fable 5"
date: 2026-07-31
description: "A rip current nearly killed me at a headland beach on the Kashima-nada coast. I fed the full account into Claude Opus 5, Claude Fable 5, and GPT-5.5, and asked each to reconstruct it."
tags: [surfing, claude, ai, safety]
---

A few years ago I was pulled into a headland current at Top Sante, a beach on the Kashima-nada coast, and came close to drowning. I recently wrote up the full account and gave it to three models — **Claude Opus 5**, **Claude Fable 5**, and **GPT-5.5** — asking each to reconstruct it, using an [official Ibaraki Prefecture headland pamphlet](https://www.pref.ibaraki.jp/doboku/kasen/coast/documents/headland_pamphlet.pdf) as geographic reference. This post is the write-up, plus all three results.

## What happened

Top Sante is where I originally learned to surf, entering the water between two of the T-shaped headlands built along this stretch of coast. I believe this was around August 2024, though I'm not fully certain of the date. At the time I was riding a 7.6 ft mid-length, had been surfing for about 3 years, had over 50 sessions total, and this was only my 5th time surfing that specific spot at Top Sante. This particular session was about two days before a typhoon; the forecast (checked on BCM) put the wave height around 1.5 m.

I paddled out around 10am. At least 40 other surfers were already in the water, and I went in from the middle of the gap between the two headlands without checking the current beforehand.

The waves kept breaking hard and I couldn't get past them to paddle out. After about ten minutes of fighting through the whitewater, I realized I had drifted close to the tetrapods on the north headland — maybe 30 m away. That meant there had to be a steady northward current pulling me toward it.

Recognizing the danger, I started paddling south, away from the north head. After about 15 seconds I didn't feel like I'd made any progress, and when I looked back the tetrapods were now only about 20 m away. Thinking that was bad, I tried heading straight for shore instead — another 15 seconds of paddling — but that only brought the headland itself to within about 10 m.

At that point I genuinely panicked. The tetrapods had 1.5 m waves breaking on them constantly; getting swept into them meant no way out. I thought I was going to die.

As a last resort, I remembered that the area around a headland almost always has a rip current running out to sea, even though the waves themselves were breaking toward shore — so I wasn't sure whether paddling into it would actually pull me clear or just get pushed back in. With nothing else left to try, and expecting to be swallowed by the tetrapods any second, I paddled straight out to sea through what I guessed was the rip.

It worked immediately — the current pulled me offshore fast. I ended up on the southeast side of the headland, and before I had any time to think about what to do next, a strong current swept me sideways to the north, straight across to the *other* headland. The whole time, 1.5 m waves kept breaking around me; if I'd been caught in that whitewater, current or no current, it would have carried me straight into the tetrapods with nothing I could do.

I ended up right in front of this huge wall of concrete blocks, unable to move under my own power, and thought I was completely finished. But somehow I never got caught by a breaking wave, and drifted past to the north side of the tetrapods instead. From there I paddled to shore as hard as I've ever paddled anything and made it out.

Afterward, I found out that both friends I'd paddled out with that day had independently gone through the same thing and also thought they were going to die. It really had been that dangerous a day.

A more experienced surfer friend later told me two things: first, that I should have warned the other surfers in the water about how strong the current was; and second, that before entering the water in conditions like this, I should watch from the beach first — specifically, whether the surfers already out there are drifting, or are having to paddle continuously just to hold their position — to judge the current's strength before ever paddling out.

## Turning it into a reconstruction

I gave both models the same source material: this account, plus the prefecture's headland pamphlet showing the T-shaped groin layout and the aerial/satellite imagery of the site. I asked each to reconstruct the incident visually and to check with me first if anything needed clarifying before building it.

- **Claude Opus 5** produced an annotated plan-view chart of the beach cell — the track of the drift plotted against the two headlands, with call-outs on the two mistakes (paddling straight against the current, and heading for shore instead of rounding the head) and the order of moves that actually worked.
- **Claude Fable 5** produced a canvas-based animated reenactment of the same sequence of events, played out in real time along the beach.
- **GPT-5.5** couldn't produce video/animation, so it produced a 14-panel infographic instead, walking through the whole sequence from paddle-out to reaching the beach, plus a short explainer on why the current pulls swimmers toward the headland.

## Results

- [Plan-view incident chart (Claude Opus 5)](/experiments/kashimanada-headland-incident/)
- [Animated reenactment (Claude Fable 5)](/experiments/kashimanada-headland-incident/animation.html)
- 14-panel infographic (GPT-5.5):

  ![14-panel infographic reconstructing the Kashima-nada headland incident, generated by GPT-5.5](/experiments/kashimanada-headland-incident/gpt-5.5-infographic.png)

The two HTML pages are self-contained — open either one directly.

## Takeaway

None of this was a paddling-skill problem. A south swell two days ahead of a typhoon, a headland field, and a mid-gap entry did the rest. The fix isn't a stronger paddle — it's watching the water from the beach before getting in it: are the surfers already out there holding position, or drifting.
