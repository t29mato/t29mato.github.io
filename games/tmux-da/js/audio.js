// Chiptune music and sound effects, synthesised with the Web Audio API.
// No files are loaded: every tune is written out below as note names.
// Browsers only allow sound after the player has clicked or pressed a key,
// so nothing plays until unlock() has been called from such an event.
(function () {
  'use strict';

  // Tokens are NOTE:LEN, LEN in sixteenth notes. '-' is a rest.
  // Drum voices use k (kick), s (snare) and h (hat) instead of notes.
  var TRACKS = {
    title: {
      bpm: 108, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.5, notes:
          'G4:4 C5:4 E5:4 G5:4 F5:6 E5:2 D5:4 C5:4 A4:4 D5:4 F5:4 A5:4 G5:12 -:4 ' +
          'E5:4 F5:4 G5:4 C6:4 B5:6 A5:2 G5:4 F5:4 E5:4 D5:4 G4:4 B4:4 C5:12 -:4' },
        { wave: 'triangle', gain: 0.9, notes:
          'C3:4 G3:4 C3:4 G3:4 F2:4 C3:4 F2:4 A2:4 D3:4 A3:4 D3:4 F3:4 G2:4 D3:4 G2:4 B2:4 ' +
          'C3:4 G3:4 E3:4 G3:4 G2:4 D3:4 D3:4 G2:4 C3:4 E3:4 G2:4 G2:4 C3:8 G2:4 C3:4' }
      ]
    },
    village: {
      bpm: 120, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.45, notes:
          'C5:2 D5:2 F5:4 A5:4 G5:2 F5:2 G5:4 C5:4 C5:8 D5:2 E5:2 F5:4 G5:4 A5:2 Bb5:2 A5:4 G5:4 F5:8 ' +
          'A5:2 Bb5:2 C6:4 A5:4 F5:4 G5:2 A5:2 Bb5:4 G5:4 E5:4 F5:4 A5:4 G5:2 F5:2 E5:2 G5:2 F5:12 -:4' },
        { wave: 'triangle', gain: 0.9, notes:
          'F2:4 C3:4 A2:4 C3:4 C3:4 G2:4 E2:4 G2:4 Bb2:4 F3:4 D3:4 F3:4 F2:4 C3:4 A2:4 C3:4 ' +
          'F2:4 C3:4 F3:4 C3:4 C3:4 G2:4 C3:4 G2:4 F2:4 A2:4 C3:4 C2:4 F2:8 C3:4 F2:4' }
      ]
    },
    tower: {
      bpm: 96, loop: true,
      voices: [
        { wave: 'pulse12', gain: 0.45, notes:
          'A4:2 C5:2 E5:2 A5:2 G5:4 E5:4 F5:2 E5:2 D5:2 C5:2 B4:8 A4:2 C5:2 E5:2 A5:2 B5:4 C6:4 B5:2 A5:2 G#5:2 B5:2 A5:8 ' +
          'C6:4 B5:2 A5:2 G5:4 E5:4 F5:4 E5:2 D5:2 E5:8 D5:2 E5:2 F5:2 A5:2 G#5:4 B5:4 A5:12 -:4' },
        { wave: 'triangle', gain: 0.9, notes:
          'A2:8 E3:8 D3:8 E3:8 A2:8 G2:8 E2:8 A2:8 F2:8 C3:8 D3:8 E3:8 D3:8 E3:8 A2:16' }
      ]
    },
    castle: {
      bpm: 84, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.42, notes:
          'D5:4 -:2 D5:2 F5:4 E5:4 D5:4 C#5:4 D5:8 A5:4 -:2 G5:2 F5:4 E5:4 F5:4 E5:2 D5:2 C#5:8 ' +
          'D5:2 E5:2 F5:2 G5:2 A5:4 Bb5:4 A5:4 G5:2 F5:2 E5:8 F5:2 E5:2 D5:2 C#5:2 D5:4 E5:4 D5:12 -:4' },
        { wave: 'triangle', gain: 1, notes:
          rep('D2:2 D3:2', 4) + rep('Bb1:2 Bb2:2', 4) + rep('F2:2 F3:2', 4) + rep('A1:2 A2:2', 4) +
          rep('Bb1:2 Bb2:2', 4) + rep('C2:2 C3:2', 4) + rep('A1:2 A2:2', 4) + rep('D2:2 D3:2', 4) }
      ]
    },
    battle: {
      bpm: 152, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.42, notes:
          'E5:2 E5:2 G5:2 E5:2 A5:2 G5:2 F#5:2 D5:2 E5:4 B4:4 E5:4 -:4 E5:2 E5:2 G5:2 E5:2 B5:2 A5:2 G5:2 F#5:2 G5:4 A5:4 B5:8 ' +
          'C6:2 B5:2 A5:2 G5:2 A5:2 G5:2 F#5:2 E5:2 F#5:2 G5:2 A5:2 F#5:2 D5:4 -:4 E5:2 G5:2 B5:2 E6:2 D6:2 B5:2 A5:2 F#5:2 E5:8 B4:4 -:4' },
        { wave: 'triangle', gain: 1, notes:
          rep('E2:2 E3:2', 8) + rep('E2:2 E3:2', 4) + rep('G2:2 G3:2', 2) + rep('B1:2 B2:2', 2) +
          rep('C3:2 C4:2', 4) + rep('D3:2 D4:2', 4) + rep('E2:2 E3:2', 2) + rep('D2:2 D3:2', 2) + rep('E2:2 E3:2', 2) + rep('B1:2 B2:2', 2) },
        { wave: 'noise', gain: 0.5, notes: rep('k:2 h:2 s:2 h:2', 16) }
      ]
    },
    boss: {
      bpm: 138, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.42, notes:
          'D5:2 D5:2 D#5:2 D5:2 A5:4 G#5:4 G5:2 F5:2 D#5:2 D5:2 C#5:8 D5:2 D5:2 F5:2 D5:2 Bb5:4 A5:4 G#5:2 A5:2 Bb5:2 A5:2 D5:8 ' +
          'D6:2 C6:2 Bb5:2 A5:2 G#5:4 A5:4 Bb5:2 A5:2 G5:2 F5:2 E5:8 F5:2 G5:2 A5:2 Bb5:2 C#6:4 E6:4 D6:12 -:4' },
        { wave: 'triangle', gain: 1, notes:
          rep('D2:2 D3:2', 4) + rep('C#2:2 C#3:2', 4) + rep('Bb1:2 Bb2:2', 4) + rep('A1:2 A2:2', 4) +
          rep('D2:2 D3:2', 4) + rep('G1:2 G2:2', 4) + rep('A1:2 A2:2', 4) + rep('D2:2 D3:2', 4) },
        { wave: 'noise', gain: 0.5, notes: rep('k:2 k:2 s:2 h:2', 16) }
      ]
    },
    // Jingles: played once.
    levelup: {
      bpm: 150, loop: false,
      voices: [
        { wave: 'pulse25', gain: 0.5, notes: 'G4:2 C5:2 E5:2 G5:4 E5:2 G5:2 C6:12' },
        { wave: 'triangle', gain: 0.9, notes: 'C3:4 G3:4 E3:2 G3:2 C3:14' }
      ]
    },
    victory: {
      bpm: 132, loop: false,
      voices: [
        { wave: 'pulse25', gain: 0.5, notes: 'E5:2 G5:2 C6:4 B5:2 A5:2 G5:4 A5:2 B5:2 C6:2 D6:2 E6:12' },
        { wave: 'pulse12', gain: 0.3, notes: 'C5:2 E5:2 G5:4 G5:2 F5:2 E5:4 F5:2 G5:2 A5:2 B5:2 C6:12' },
        { wave: 'triangle', gain: 0.9, notes: 'C3:8 F3:8 G3:8 C3:12' }
      ]
    },
    gameover: {
      bpm: 90, loop: false,
      voices: [
        { wave: 'pulse25', gain: 0.5, notes: 'E5:4 D#5:4 D5:4 C#5:12' },
        { wave: 'triangle', gain: 0.9, notes: 'A2:8 G#2:8 G2:8' }
      ]
    }
  };

  function rep(s, n) { var out = ''; for (var i = 0; i < n; i++) out += s + ' '; return out; }

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

  var ctx = null, master = null, waves = {}, noiseBuf = null;
  var enabled = true;
  var current = null;      // {name, gain, timer}
  var wanted = null;       // the track to play once sound is unlocked

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
    // Pulse waves with 12.5% and 25% duty, the classic 8-bit timbres.
    [['pulse12', 0.125], ['pulse25', 0.25]].forEach(function (w) {
      var n = 32, re = new Float32Array(n), im = new Float32Array(n);
      for (var k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * w[1]);
      waves[w[0]] = ctx.createPeriodicWave(re, im);
    });
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function osc(wave, f, t0, dur, gain, dest, glide) {
    var o = ctx.createOscillator();
    if (waves[wave]) o.setPeriodicWave(waves[wave]);
    else o.type = wave === 'triangle' ? 'triangle' : wave === 'sawtooth' ? 'sawtooth' : 'square';
    o.frequency.setValueAtTime(f, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.setValueAtTime(gain, t0 + Math.max(0.01, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function drum(kind, t0, gain, dest) {
    if (kind === 'k') { osc('triangle', 150, t0, 0.12, gain * 1.4, dest, 40); return; }
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = kind === 'h' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'h' ? 7000 : 1800;
    var g = ctx.createGain();
    var dur = kind === 'h' ? 0.04 : 0.12;
    g.gain.setValueAtTime(gain * (kind === 'h' ? 0.5 : 1), t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // Schedules one pass of a track from t0. Returns its length in seconds.
  function schedule(track, t0, dest) {
    var sixteenth = 60 / track.bpm / 4;
    var longest = 0;
    track.voices.forEach(function (v) {
      var t = t0;
      v.parsed = v.parsed || parse(v.notes);
      v.parsed.forEach(function (ev) {
        var dur = ev.len * sixteenth;
        if (ev.n !== '-') {
          if (v.wave === 'noise') drum(ev.n, t, v.gain, dest);
          else osc(v.wave, freq(ev.n), t, dur * 0.92, v.gain, dest);
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
    if (ctx) {
      var now = ctx.currentTime;
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
    if (!enabled || !ctx || ctx.state !== 'running') return;
    if (current && current.name === name && track.loop) return;
    // A jingle finishes first; the tune asked for meanwhile follows it.
    if (track.loop && current && current.jingle) { current.then = name; return; }
    stop(0.08);
    var g = ctx.createGain();
    g.gain.value = 1;
    g.connect(master);
    var me = { name: name, gain: g, timer: 0, jingle: !track.loop, then: then || null };
    current = me;
    var t0 = ctx.currentTime + 0.06;
    (function pass(start) {
      if (current !== me) return;
      var len = schedule(track, start, g);
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

  // Short effects, layered over the music.
  var SE = {
    blip: function (t) { osc('pulse25', 1320, t, 0.025, 0.25, master); },
    cursor: function (t) { osc('pulse25', 990, t, 0.04, 0.35, master); },
    prefix: function (t) { osc('pulse12', 660, t, 0.04, 0.3, master); osc('pulse12', 990, t + 0.04, 0.05, 0.3, master); },
    cmd: function (t) { [784, 988, 1175].forEach(function (f, i) { osc('pulse25', f, t + i * 0.035, 0.05, 0.3, master); }); },
    miss: function (t) { osc('square', 180, t, 0.18, 0.35, master, 90); },
    hit: function (t) { drum('s', t, 1.4, master); osc('square', 520, t, 0.12, 0.3, master, 120); },
    open: function (t) { [523, 659, 784, 1047].forEach(function (f, i) { osc('triangle', f, t + i * 0.07, 0.12, 0.7, master); }); },
    hurt: function (t) { drum('s', t, 1.6, master); drum('k', t + 0.05, 1.2, master); },
    tick: function (t) { osc('pulse12', 1760, t, 0.02, 0.2, master); }
  };

  function se(name) {
    if (!enabled || !ctx || ctx.state !== 'running' || !SE[name]) return;
    SE[name](ctx.currentTime + 0.005);
  }

  // Call from a click or key handler. Starts whatever was asked for meanwhile.
  function unlock() {
    if (!enabled || away()) return;
    if (!ensure()) return;
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
    if (!ctx) return;
    if (current) wanted = current.jingle ? (current.then || wanted) : current.name;
    stop(0.05);
    // Suspending also holds back effects and any tune asked for meanwhile.
    setTimeout(function () { if (away() && ctx.state === 'running') ctx.suspend(); }, 80);
  }

  function back() {
    if (away()) return;
    unlock();
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
    // For the tests: what is playing, and whether the audio clock runs.
    state: function () { return { ctx: ctx ? ctx.state : null, playing: current ? current.name : null }; }
  };
})();
