// Music and sound effects for the house, synthesised with the Web Audio
// API: a plucked koto, taiko, woodblocks, a bell. No files are loaded:
// every tune is written out below as note names.
// Browsers only allow sound after the player has clicked or pressed a key,
// so nothing plays until unlock() has been called from such an event.
(function () {
  'use strict';

  // Tokens are NOTE:LEN, LEN in sixteenth notes. '-' is a rest. The
  // percussion voice uses k (taiko), w (woodblock) and h (a rim tick)
  // instead of notes. Every voice of a looping track is the same length, so
  // the seam lands on a bar line for all of them. The melodies keep to the
  // miyako-bushi scale on E (E F A B C), played on a plucked "koto".

  function rep(s, n) { var out = []; for (var i = 0; i < n; i++) out.push(s); return out.join(' '); }
  function bars(list) { return list.join(' '); }
  // One bar of a low koto figure: root, fifth, octave, fifth.
  function low(r, f, o) { return r + ':4 ' + f + ':4 ' + o + ':4 ' + f + ':4'; }
  // One bar of eighth-note pulse on two strings, for the faster tune.
  function pulse(a, b) { return rep(a + ':2 -:2 ' + b + ':2 -:2', 2); }

  var TRACKS = {
    // The house at night: slow, sparse, with a drone.
    title: {
      bpm: 72, loop: true,
      voices: [
        { wave: 'koto', gain: 0.55, notes: bars([
          'E5:4 -:2 C5:2 B4:8', 'A4:4 B4:2 C5:2 B4:4 A4:4', 'F4:6 A4:2 B4:8', 'E4:12 -:4',
          'A4:4 -:2 B4:2 C5:4 E5:4', 'F5:6 E5:2 C5:4 B4:4', 'A4:4 F4:4 A4:2 B4:2 C5:4', 'B4:12 -:4']) },
        { wave: 'koto', gain: 0.28, notes: bars([
          low('E3', 'B3', 'E4'), low('A2', 'E3', 'A3'), low('F2', 'C3', 'F3'), low('E3', 'B3', 'E4'),
          low('A2', 'E3', 'A3'), low('F2', 'C3', 'F3'), low('A2', 'E3', 'A3'), low('E3', 'B3', 'E4')]) },
        { wave: 'sine', gain: 0.22, notes: rep('E2:16', 8) },
        { wave: 'noise', gain: 0.18, notes: rep('-:12 h:4', 7) + ' -:8 w:4 w:4' }
      ]
    },
    // Playing: the same scale, faster, over taiko and a woodblock.
    play: {
      bpm: 132, loop: true,
      voices: [
        { wave: 'koto', gain: 0.5, notes: bars([
          'E5:2 F5:2 E5:2 C5:2 B4:4 A4:4', 'B4:2 C5:2 B4:2 A4:2 F4:4 E4:4', 'A4:2 B4:2 C5:2 E5:2 F5:4 E5:4', 'C5:2 B4:2 A4:2 B4:2 E4:8',
          'E5:2 F5:2 A5:2 F5:2 E5:4 C5:4', 'B4:2 C5:2 E5:2 C5:2 B4:4 A4:4', 'F4:2 A4:2 B4:2 C5:2 B4:4 A4:2 F4:2', 'E4:12 -:4']) },
        { wave: 'koto', gain: 0.26, notes: bars([
          pulse('E3', 'B3'), pulse('E3', 'B3'), pulse('A2', 'E3'), pulse('E3', 'B3'),
          pulse('A2', 'E3'), pulse('F2', 'C3'), pulse('F2', 'C3'), pulse('E3', 'B3')]) },
        { wave: 'noise', gain: 0.4, notes: rep('k:4 w:2 w:2 k:2 k:2 w:4', 7) + ' k:2 k:2 k:2 k:2 w:2 w:2 k:4' }
      ]
    },
    // Jingles: played once. Reaching the inner room: a glissando up.
    clear: {
      bpm: 120, loop: false,
      voices: [
        { wave: 'koto', gain: 0.55, notes: 'E4:1 F4:1 A4:1 B4:1 C5:1 E5:1 F5:1 A5:1 B5:8 E5:8' },
        { wave: 'koto', gain: 0.3, notes: '-:8 E3:8 B3:8' },
        { wave: 'noise', gain: 0.5, notes: '-:8 w:4 -:2 w:10' }
      ]
    },
    // A new best time: the glissando twice, then taiko.
    record: {
      bpm: 120, loop: false,
      voices: [
        { wave: 'koto', gain: 0.55, notes: 'E4:1 F4:1 A4:1 B4:1 C5:1 E5:1 F5:1 A5:1 B5:4 A5:2 B5:2 E6:16' },
        { wave: 'koto', gain: 0.3, notes: '-:8 E3:4 B3:4 E4:16' },
        { wave: 'noise', gain: 0.55, notes: '-:8 k:2 k:2 k:4 -:4 k:4 w:4 w:4' }
      ]
    },
    // A rank climbed: a run up the scale.
    rankup: {
      bpm: 132, loop: false,
      voices: [
        { wave: 'koto', gain: 0.55, notes: 'A4:2 B4:2 C5:2 E5:2 F5:2 A5:2 B5:12' },
        { wave: 'koto', gain: 0.3, notes: '-:12 E4:12' },
        { wave: 'noise', gain: 0.5, notes: '-:12 w:4 w:8' }
      ]
    }
  };

  var SEMI = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  function freq(name) {
    var m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) return 0;
    var n = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
    return 440 * Math.pow(2, n / 12);
  }

  function parse(notes) {
    return notes.trim().split(/\s+/).map(function (t) {
      var p = t.split(':');
      return { n: p[0], len: Number(p[1]) || 1 };
    });
  }

  // ---- engine ------------------------------------------------------------------

  // Everything that plays goes through a "rig": a context with its master
  // gain and the noise buffer. The live rig is built on the
  // first unlock; render() builds a throwaway offline one for the tests.
  var rig = null;
  var enabled = true;
  var current = null;      // {name, gain, timer}
  var wanted = null;       // the track to play once sound is unlocked

  function makeRig(ac) {
    var r = { ctx: ac, master: ac.createGain(), waves: {}, noise: null };
    r.master.gain.value = 0.16;
    r.master.connect(ac.destination);
    r.noise = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    var d = r.noise.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return r;
  }

  function ensure() {
    if (rig) return rig;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { rig = makeRig(new AC()); } catch (e) { return null; }
    return rig;
  }

  // One note. env: 'pluck' decays to a quarter over the note, like a plucked
  // string; the default holds until a short release.
  function osc(r, wave, f, t0, dur, gain, dest, glide, env) {
    var ctx = r.ctx;
    var o = ctx.createOscillator();
    if (r.waves[wave]) o.setPeriodicWave(r.waves[wave]);
    else o.type = wave === 'sine' ? 'sine' : wave === 'sawtooth' ? 'sawtooth' : wave === 'square' ? 'square' : 'triangle';
    // The koto: a bright attack that dies away, whatever the note's length.
    if (wave === 'koto') env = 'koto';
    o.frequency.setValueAtTime(f, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    if (env === 'koto') g.gain.exponentialRampToValueAtTime(gain * 0.02, t0 + Math.min(1.6, Math.max(0.05, dur)));
    else if (env === 'pluck') g.gain.exponentialRampToValueAtTime(gain * 0.25, t0 + Math.max(0.02, dur - 0.03));
    else g.gain.setValueAtTime(gain, t0 + Math.max(0.01, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.02);
    // The string's brighter overtone, gone almost at once.
    if (env === 'koto') osc(r, 'sine', f * 2, t0, Math.min(0.25, dur), gain * 0.35, dest, 0, 'pluck');
  }

  // Percussion: k is a taiko (a low thump that falls), w a woodblock (a
  // short knock), h a dry rim tick, s a slap of noise.
  function drum(r, kind, t0, gain, dest) {
    if (kind === 'k') { osc(r, 'sine', 110, t0, 0.32, gain * 1.6, dest, 46); noise(r, t0, 0.05, 900, 'lowpass', gain * 0.5, dest); return; }
    if (kind === 'w') { osc(r, 'sine', 1180, t0, 0.07, gain * 0.9, dest, 900); noise(r, t0, 0.025, 2400, 'bandpass', gain * 0.6, dest); return; }
    if (kind === 'h') { noise(r, t0, 0.03, 5200, 'bandpass', gain * 0.5, dest); return; }
    noise(r, t0, 0.12, 1800, 'bandpass', gain, dest);
  }

  function noise(r, t0, dur, freqHz, type, gain, dest, sweepTo) {
    var ctx = r.ctx;
    var src = ctx.createBufferSource();
    src.buffer = r.noise;
    var f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freqHz, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    f.Q.value = type === 'bandpass' ? 1.4 : 0.7;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // A bell (鈴): a few inharmonic sine partials ringing out.
  function bell(r, f, t0, dur, gain, dest) {
    [[1, 1], [2.76, 0.45], [5.4, 0.22]].forEach(function (p) {
      var ctx = r.ctx, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * p[0], t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain * p[1], t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur / p[0] * 1.5);
      o.connect(g); g.connect(dest);
      o.start(t0); o.stop(t0 + dur + 0.05);
    });
  }

  // Schedules one pass of a track from t0. Returns its length in seconds.
  function schedule(r, track, t0, dest) {
    var sixteenth = 60 / track.bpm / 4;
    var longest = 0;
    track.voices.forEach(function (v) {
      var t = t0;
      v.parsed = v.parsed || parse(v.notes);
      v.parsed.forEach(function (ev) {
        var dur = ev.len * sixteenth;
        if (ev.n !== '-') {
          if (v.wave === 'noise') drum(r, ev.n, t, v.gain, dest);
          else osc(r, v.wave, freq(ev.n), t, dur * 0.92, v.gain, dest, 0, v.env);
        }
        t += dur;
      });
      longest = Math.max(longest, t - t0);
    });
    return longest;
  }

  function stop(fade) {
    if (!current) return;
    var c = current;
    current = null;
    clearTimeout(c.timer);
    if (rig) {
      var now = rig.ctx.currentTime;
      c.gain.gain.cancelScheduledValues(now);
      c.gain.gain.setValueAtTime(c.gain.gain.value, now);
      c.gain.gain.linearRampToValueAtTime(0, now + (fade || 0.15));
      setTimeout(function () { try { c.gain.disconnect(); } catch (e) { /* already gone */ } }, ((fade || 0.15) + 0.1) * 1000);
    }
  }

  // play(name): start a looping track, or a jingle. `then` names a track to
  // return to after a jingle.
  function play(name, then) {
    var track = TRACKS[name];
    if (!track) return;
    if (track.loop) wanted = name;
    else if (then) wanted = then;
    if (!enabled || !rig || rig.ctx.state !== 'running') return;
    if (current && current.name === name && track.loop) return;
    // A jingle finishes first; the tune asked for meanwhile follows it.
    if (track.loop && current && current.jingle) { current.then = name; return; }
    stop(0.08);
    var ctx = rig.ctx;
    var g = ctx.createGain();
    g.gain.value = 1;
    g.connect(rig.master);
    var me = { name: name, gain: g, timer: 0, jingle: !track.loop, then: then || null };
    current = me;
    var t0 = ctx.currentTime + 0.06;
    (function pass(start) {
      if (current !== me) return;
      var len = schedule(rig, track, start, g);
      if (track.loop) {
        me.timer = setTimeout(function () { pass(start + len); }, Math.max(0, (start + len - ctx.currentTime - 0.4) * 1000));
      } else {
        me.timer = setTimeout(function () {
          if (current !== me) return;
          current = null;
          if (me.then) play(me.then);
        }, (start + len - ctx.currentTime + 0.25) * 1000);
      }
    })(t0);
  }

  // Short effects, layered over the music. Each takes the rig, the start
  // time and the master gain; some take a detail (the hit streak).
  // The scale the hits climb, a step per question in a streak.
  var MIYAKO = ['E5', 'F5', 'A5', 'B5', 'C6', 'E6', 'F6', 'A6', 'B6'];

  var SE = {
    cursor: function (r, t, m) { drum(r, 'w', t, 0.45, m); },
    // The prefix: a small latch clicking open.
    prefix: function (r, t, m) { osc(r, 'sine', 2100, t, 0.03, 0.25, m, 1500); noise(r, t, 0.02, 3800, 'bandpass', 0.35, m); },
    // Any tmux command: a sliding door (襖).
    cmd: function (r, t, m) { noise(r, t, 0.16, 500, 'bandpass', 0.55, m, 1400); },
    // A wrong key: the bell (鈴), and a dull knock under it.
    miss: function (r, t, m) { bell(r, 1320, t, 0.9, 0.35, m); osc(r, 'sine', 160, t, 0.12, 0.4, m, 90); },
    // A question solved: the mechanism's カタン, and a koto note that climbs
    // the scale with the streak.
    hit: function (r, t, m, streak) {
      var step = Math.min(Math.max(streak || 1, 1) - 1, MIYAKO.length - 1);
      drum(r, 'w', t, 0.9, m);
      osc(r, 'sine', 640, t + 0.07, 0.08, 0.5, m, 420);
      noise(r, t + 0.07, 0.04, 1200, 'bandpass', 0.5, m);
      osc(r, 'koto', freq(MIYAKO[step]), t + 0.05, 0.6, 0.4, m);
      if (streak && streak % 5 === 0) bell(r, freq(MIYAKO[Math.min(step + 2, MIYAKO.length - 1)]), t + 0.18, 1.2, 0.25, m);
    },
    // The 目安 passed: a lamp catching light.
    andon: function (r, t, m) { noise(r, t, 0.45, 300, 'lowpass', 0.5, m, 2200); osc(r, 'sine', 220, t + 0.05, 0.5, 0.25, m, 330); },
    // The guide appears: two soft bells.
    shinan: function (r, t, m) { bell(r, 880, t, 0.8, 0.22, m); bell(r, 1174.66, t + 0.16, 0.9, 0.2, m); },
    // The countdown: hyoshigi (拍子木), once per count, twice to start.
    tick: function (r, t, m) { drum(r, 'w', t, 0.9, m); },
    go: function (r, t, m) { drum(r, 'w', t, 1, m); drum(r, 'w', t + 0.13, 1.1, m); drum(r, 'k', t + 0.13, 0.8, m); }
  };

  function se(name, detail) {
    if (!enabled || !rig || rig.ctx.state !== 'running' || !SE[name]) return;
    SE[name](rig, rig.ctx.currentTime + 0.005, rig.master, detail);
  }

  // Call from a click or key handler. Starts whatever was asked for meanwhile.
  function unlock() {
    if (!enabled || away()) return;
    if (!ensure()) return;
    var ctx = rig.ctx;
    var resume = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
    resume.then(function () { if (wanted && (!current || current.name !== wanted)) play(wanted); }, function () { /* still locked */ });
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) stop(0.1);
    else unlock();
  }

  // Silence while the player is elsewhere: another tab, another window, or
  // the browser minimised. The tune starts again on return.
  function away() {
    return document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus());
  }

  function leave() {
    if (!rig) return;
    if (current) wanted = current.jingle ? (current.then || wanted) : current.name;
    stop(0.05);
    // Suspending also holds back effects and any tune asked for meanwhile.
    setTimeout(function () { if (away() && rig.ctx.state === 'running') rig.ctx.suspend(); }, 80);
  }

  function back() {
    if (away()) return;
    unlock();
  }

  // For the tests: renders `secs` of a track (looping) or an effect offline
  // and reports the peak and the loudness over time, so a tune can be
  // checked for clipping and for gaps at the seam without anyone listening.
  function render(name, secs, detail) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var track = TRACKS[name];
    if (!OAC || (!track && !SE[name])) return Promise.reject(new Error('cannot render ' + name));
    var rate = 22050;
    var ac = new OAC(1, Math.ceil(rate * secs), rate);
    var r = makeRig(ac);
    if (track) {
      var t = 0.01, len = 0;
      while (t < secs) { len = schedule(r, track, t, r.master); t += len; if (!track.loop) break; }
    } else SE[name](r, 0.01, r.master, detail);
    return ac.startRendering().then(function (buf) {
      var d = buf.getChannelData(0), peak = 0, win = Math.floor(rate * 0.05), bins = [];
      for (var i = 0; i < d.length; i += win) {
        var sum = 0, n = Math.min(win, d.length - i);
        for (var j = 0; j < n; j++) { var x = d[i + j]; sum += x * x; if (Math.abs(x) > peak) peak = Math.abs(x); }
        bins.push(+Math.sqrt(sum / n).toFixed(4));
      }
      return { peak: +peak.toFixed(4), rms: bins, loop: track ? +trackLen(track).toFixed(4) : 0 };
    });
  }

  // The length of a track in seconds, and each voice's length in sixteenths.
  function trackLen(track) {
    var s = 0;
    parse(track.voices[0].notes).forEach(function (e) { s += e.len; });
    return s * 60 / track.bpm / 4;
  }
  function voiceLens(name) {
    return TRACKS[name].voices.map(function (v) {
      var s = 0, bad = [];
      parse(v.notes).forEach(function (e) { s += e.len; if (e.n !== '-' && !/^[kwhs]$/.test(e.n) && !freq(e.n)) bad.push(e.n); });
      return { wave: v.wave, len: s, bad: bad };
    });
  }

  document.addEventListener('visibilitychange', function () { if (away()) leave(); else back(); });
  window.addEventListener('blur', leave);
  window.addEventListener('focus', back);

  window.ADV = window.ADV || {};
  window.ADV.audio = {
    play: play,
    stop: function () { wanted = null; stop(); },
    se: se,
    unlock: unlock,
    setEnabled: setEnabled,
    enabled: function () { return enabled; },
    tracks: function () { return Object.keys(TRACKS); },
    voiceLens: voiceLens,
    render: render,
    // For the tests: what is playing, and whether the audio clock runs.
    state: function () { return { ctx: rig ? rig.ctx.state : null, playing: current ? current.name : null }; }
  };
})();
