---
layout: page
title: Illustrations
permalink: /illustrations/
tty_cwd: ~/site/after-hours/illustrations
tty_cmd: ls -l

# One entry per plate. `w`/`h` are the file's real pixel size — the include
# prints them and uses them as the intrinsic ratio, so keep them true.
illustrations:
  - name: Board under arm
    img: /assets/illustrations/board-under-arm.jpg
    w: 1122
    h: 1402
    alt: >-
      A flat-colour illustration of a surfer in a blue wetsuit top walking up
      the sand with a white longboard under one arm, the sea in bands behind
      and a low orange sun.
    tags: [Flat colour, Surf]
    blurb: >-
      Walking back up the sand with the board under one arm and the leash
      trailing, sun already low. Four colours and a horizon — the same coast
      the two reconstructions under animations/ are about, on a day when
      nothing went wrong.
    note: >-
      Made with an image model (OpenAI's gpt-image) to a written brief, then
      picked out of several takes and stripped of its metadata. The figure is
      not a portrait — see below.
---

# Illustrations

<p class="page-intro" markdown="1">
Pictures made for this site rather than found for it. There is no photograph
of me anywhere here and there is not going to be one; this is what stands in
that place instead.
</p>

{% include art.html items=page.illustrations %}

{% include tty-prompt.html cwd="~/site/after-hours/illustrations" cmd="cat NO-FACES" %}

<div class="tty-block lab-rules">
  <span class="tty-line tty-dim">The face is turned away and left unresolved on purpose. What the plate carries is a posture, a board and a coastline — nothing anyone could pick a person out of a crowd by.</span>
  <span class="tty-line tty-dim">That is the whole reason this version is the one published. A likeness drawn from a photograph is still a likeness: an earlier take had a full face, recognisable in a second to anyone who has met me, and it is not on this site for exactly that reason. Illustration is not anonymity by itself — the choice of what to draw is.</span>
  <span class="tty-line tty-dim">The file is served from here and fetches nothing. It carries no EXIF, no GPS and no C2PA manifest: the generator's provenance chunk held a pair of identifiers and 21 KB of signing certificate, and none of that is the page's business, so the image was re-encoded from pixels alone.</span>
  <span class="tty-line tty-dim">The model's invisible watermark lives in those pixels and is still there. Removing it was never the point — saying where the picture came from is, and that is what the note under the plate is for.</span>
</div>
