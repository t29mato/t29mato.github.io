// Chiptune music and sound effects, synthesised with the Web Audio API.
// No files are loaded: every tune is written out below as note names.
// Browsers only allow sound after the player has clicked or pressed a key,
// so nothing plays until unlock() has been called from such an event.
(function () {
  'use strict';

  // Tokens are NOTE:LEN, LEN in sixteenth notes. '-' is a rest.
  // Drum voices use k (kick), s (snare) and h (hat) instead of notes.
  // Every voice of a looping track is the same length, so the seam lands on
  // a bar line for all of them; the last bar of each tune leads back to the
  // first. Voices: pulse25 carries the tune, pulse12 the harmony (arpeggios
  // or off-beat stabs), triangle the bass, noise the drums.

  function rep(s, n) { var out = []; for (var i = 0; i < n; i++) out.push(s); return out.join(' '); }
  // One bar of eighth-note arpeggio: root, third, fifth, third, twice.
  function arp(a, b, c) { return rep(a + ':2 ' + b + ':2 ' + c + ':2 ' + b + ':2', 2); }
  // One bar of off-beat stabs alternating two chord tones.
  function stab(a, b) { return rep('-:2 ' + a + ':2 -:2 ' + b + ':2', 2); }
  // One bar of pumping eighths on the root: low, low, octave, low.
  function pump(lo, hi) { return rep(lo + ':2 ' + lo + ':2 ' + hi + ':2 ' + lo + ':2', 2); }
  // One bar of root and fifth in quarters, the walking bass of the slow tunes.
  function walk(r, f) { return r + ':4 ' + f + ':4 ' + r + ':4 ' + f + ':4'; }
  function bars(list) { return list.join(' '); }

  var TRACKS = {
    // The overture: a bright march in C, 16 bars.
    title: {
      bpm: 112, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.4, notes: bars([
          'G4:4 C5:4 E5:4 G5:4', 'E5:8 C5:4 D5:4', 'F5:4 A5:4 G5:4 E5:4', 'D5:12 B4:4',
          'A4:4 C5:4 E5:4 A5:4', 'F5:6 E5:2 D5:4 C5:4', 'D5:4 F5:4 G5:4 B5:4', 'C6:12 -:4',
          'E5:4 A5:4 C6:4 E6:4', 'D6:6 C6:2 A5:4 F5:4', 'G5:4 B5:4 D6:8', 'E6:4 D6:4 B5:4 G5:4',
          'A5:4 C6:4 D6:4 E6:4', 'D6:4 B5:4 G5:4 D5:4', 'F5:4 E5:4 D5:4 B4:4', 'C5:12 -:4']) },
        { wave: 'pulse12', gain: 0.17, env: 'pluck', notes: bars([
          arp('C4', 'E4', 'G4'), arp('C4', 'E4', 'G4'), 'F3:2 A3:2 C4:2 A3:2 G3:2 B3:2 D4:2 B3:2', arp('G3', 'B3', 'D4'),
          arp('A3', 'C4', 'E4'), arp('F3', 'A3', 'C4'), 'D4:2 F4:2 A4:2 F4:2 G3:2 B3:2 D4:2 B3:2', arp('C4', 'E4', 'G4'),
          arp('A3', 'C4', 'E4'), arp('F3', 'A3', 'C4'), arp('G3', 'B3', 'D4'), arp('E4', 'G4', 'B4'),
          arp('F3', 'A3', 'C4'), arp('G3', 'B3', 'D4'), arp('G3', 'B3', 'F4'), arp('C4', 'E4', 'G4')]) },
        { wave: 'triangle', gain: 0.85, notes: bars([
          walk('C3', 'G2'), walk('C3', 'G2'), 'F2:4 C3:4 G2:4 D3:4', walk('G2', 'D3'),
          walk('A2', 'E3'), walk('F2', 'C3'), 'D3:4 A2:4 G2:4 D3:4', walk('C3', 'G2'),
          walk('A2', 'E3'), walk('F2', 'C3'), walk('G2', 'D3'), walk('E3', 'B2'),
          walk('F2', 'C3'), walk('G2', 'D3'), 'G2:4 B2:4 D3:4 F3:4', 'C3:8 G2:4 C3:4']) },
        { wave: 'noise', gain: 0.28, notes: rep('k:4 h:4 k:4 h:4', 16) }
      ]
    },
    // The arena lobby: a tense march in D minor, 8 bars.
    arena: {
      bpm: 120, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.38, notes: bars([
          'D5:4 F5:2 E5:2 D5:4 A4:4', 'D5:4 F5:4 G5:4 A5:4', 'Bb5:6 A5:2 G5:4 F5:4', 'E5:4 C#5:4 E5:8',
          'D5:4 F5:2 E5:2 D5:4 A4:4', 'G5:4 Bb5:4 A5:4 G5:4', 'F5:4 D5:4 E5:4 C#5:4', 'D5:12 -:4']) },
        { wave: 'pulse12', gain: 0.16, notes: bars([
          stab('F4', 'A4'), stab('F4', 'A4'), stab('F4', 'Bb4'), stab('C#4', 'E4'),
          stab('F4', 'A4'), stab('D4', 'G4'), '-:2 F4:2 -:2 Bb4:2 -:2 C#4:2 -:2 E4:2', stab('F4', 'A4')]) },
        { wave: 'triangle', gain: 0.85, notes: bars([
          pump('D2', 'D3'), pump('D2', 'D3'), pump('Bb1', 'Bb2'), pump('A1', 'A2'),
          pump('D2', 'D3'), pump('G1', 'G2'), 'Bb1:2 Bb1:2 Bb2:2 Bb1:2 A1:2 A1:2 A2:2 A1:2', pump('D2', 'D3')]) },
        { wave: 'noise', gain: 0.32, notes: rep('k:4 s:4 k:2 k:2 s:4', 8) }
      ]
    },
    // Chapter 1, the village: a skipping tune in F, 16 bars.
    village: {
      bpm: 124, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.38, notes: bars([
          'F5:3 G5:1 A5:4 C6:4 A5:4', 'Bb5:3 A5:1 G5:4 F5:8', 'G5:3 A5:1 Bb5:4 A5:4 G5:4', 'F5:4 E5:4 F5:8',
          'A5:3 Bb5:1 C6:4 D6:4 C6:4', 'A5:4 F5:4 D5:8', 'G5:3 A5:1 Bb5:4 C6:4 E5:4', 'F5:12 -:4',
          'D6:3 C6:1 Bb5:4 A5:4 Bb5:4', 'C6:4 A5:4 F5:8', 'G5:3 A5:1 Bb5:4 D6:4 C6:4', 'Bb5:4 G5:4 E5:8',
          'F5:3 G5:1 A5:4 C6:4 A5:4', 'D6:4 C6:4 A5:8', 'G5:4 Bb5:4 E5:4 G5:4', 'F5:12 -:4']) },
        { wave: 'pulse12', gain: 0.15, notes: bars([
          stab('F4', 'A4'), stab('F4', 'Bb4'), stab('E4', 'G4'), stab('F4', 'A4'),
          stab('F4', 'A4'), stab('F4', 'A4'), '-:2 G4:2 -:2 Bb4:2 -:2 E4:2 -:2 G4:2', stab('F4', 'A4'),
          stab('F4', 'Bb4'), stab('F4', 'A4'), stab('G4', 'Bb4'), stab('E4', 'G4'),
          stab('F4', 'A4'), stab('F4', 'A4'), '-:2 G4:2 -:2 Bb4:2 -:2 E4:2 -:2 Bb4:2', stab('F4', 'A4')]) },
        { wave: 'triangle', gain: 0.85, notes: bars([
          walk('F2', 'C3'), walk('Bb2', 'F3'), walk('C3', 'G2'), walk('F2', 'C3'),
          walk('F2', 'C3'), walk('D3', 'A2'), 'G2:4 D3:4 C3:4 G2:4', walk('F2', 'C3'),
          walk('Bb2', 'F3'), walk('F2', 'C3'), walk('G2', 'D3'), walk('C3', 'G2'),
          walk('F2', 'C3'), walk('D3', 'A2'), 'G2:4 D3:4 C3:4 E3:4', 'F2:8 C3:4 F2:4']) },
        { wave: 'noise', gain: 0.2, notes: rep('-:4 h:4 -:4 h:4', 16) }
      ]
    },
    // Chapter 2, the tower: a wary minor tune in A, 16 bars.
    tower: {
      bpm: 100, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.36, notes: bars([
          'A4:8 C5:4 E5:4', 'D5:6 C5:2 B4:8', 'F5:4 E5:4 D5:4 C5:4', 'B4:12 -:4',
          'A4:8 C5:4 E5:4', 'G5:6 F5:2 E5:8', 'F5:4 E5:4 D5:4 G#4:4', 'A4:12 -:4',
          'D5:4 F5:4 A5:4 F5:4', 'E5:6 C5:2 A4:8', 'D5:4 F5:4 A5:4 C6:4', 'B5:8 G#5:4 E5:4',
          'F5:4 A5:4 C6:4 A5:4', 'G5:4 B5:4 D6:4 B5:4', 'G#5:4 E5:4 B4:4 G#4:4', 'A4:12 -:4']) },
        { wave: 'pulse12', gain: 0.15, env: 'pluck', notes: bars([
          arp('A3', 'E4', 'A4'), arp('A3', 'E4', 'A4'), arp('F3', 'C4', 'F4'), arp('E3', 'B3', 'E4'),
          arp('A3', 'E4', 'A4'), arp('G3', 'D4', 'G4'), 'F3:2 C4:2 F4:2 C4:2 E3:2 B3:2 E4:2 B3:2', arp('A3', 'E4', 'A4'),
          arp('D3', 'A3', 'D4'), arp('A3', 'E4', 'A4'), arp('D3', 'A3', 'D4'), arp('E3', 'B3', 'E4'),
          arp('F3', 'C4', 'F4'), arp('G3', 'D4', 'G4'), arp('E3', 'B3', 'E4'), arp('A3', 'E4', 'A4')]) },
        { wave: 'triangle', gain: 0.85, notes: bars([
          'A2:8 E2:8', 'A2:8 E2:8', 'F2:8 C3:8', 'E2:8 B2:8',
          'A2:8 E2:8', 'G2:8 D3:8', 'F2:8 E2:8', 'A2:16',
          'D3:8 A2:8', 'A2:8 E2:8', 'D3:8 A2:8', 'E2:8 B2:8',
          'F2:8 C3:8', 'G2:8 D3:8', 'E2:8 E2:8', 'A2:16']) },
        { wave: 'noise', gain: 0.3, notes: rep('k:4 -:4 s:4 -:2 h:2', 16) }
      ]
    },
    // Chapter 3, the castle: a heavy dirge in D minor, 16 bars.
    castle: {
      bpm: 88, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.36, notes: bars([
          'D5:8 -:2 D5:2 F5:4', 'E5:4 D5:4 C#5:8', 'Bb4:8 D5:4 F5:4', 'E5:4 C#5:4 A4:8',
          'D5:8 -:2 D5:2 A5:4', 'G5:4 F5:4 E5:4 D5:4', 'F5:6 E5:2 D5:4 C#5:4', 'D5:12 -:4',
          'A5:4 Bb5:4 A5:4 G5:4', 'F5:4 E5:4 F5:4 G5:4', 'D6:6 C6:2 Bb5:4 A5:4', 'G5:4 F5:4 E5:8',
          'D5:4 F5:4 A5:4 D6:4', 'C6:4 Bb5:4 A5:4 G5:4', 'F5:4 E5:4 C#5:4 E5:4', 'D5:12 -:4']) },
        { wave: 'pulse12', gain: 0.14, notes: bars([
          'A4:4 F4:4 A4:4 F4:4', 'A4:4 F4:4 A4:4 F4:4', 'F4:4 D4:4 F4:4 D4:4', 'E4:4 C#4:4 E4:4 C#4:4',
          'A4:4 F4:4 A4:4 F4:4', 'G4:4 D4:4 G4:4 D4:4', 'F4:4 D4:4 E4:4 C#4:4', 'A4:4 F4:4 A4:4 F4:4',
          'A4:4 F4:4 A4:4 F4:4', 'G4:4 E4:4 G4:4 E4:4', 'F4:4 D4:4 F4:4 D4:4', 'E4:4 C#4:4 E4:4 C#4:4',
          'A4:4 F4:4 A4:4 F4:4', 'G4:4 D4:4 F4:4 D4:4', 'E4:4 C#4:4 E4:4 C#4:4', 'A4:4 F4:4 A4:4 F4:4']) },
        { wave: 'triangle', gain: 0.9, notes: bars([
          pump('D2', 'D3'), pump('D2', 'D3'), pump('Bb1', 'Bb2'), pump('A1', 'A2'),
          pump('D2', 'D3'), pump('G1', 'G2'), 'Bb1:2 Bb1:2 Bb2:2 Bb1:2 A1:2 A1:2 A2:2 A1:2', pump('D2', 'D3'),
          pump('D2', 'D3'), pump('C2', 'C3'), pump('Bb1', 'Bb2'), pump('A1', 'A2'),
          pump('D2', 'D3'), 'G1:2 G1:2 G2:2 G1:2 Bb1:2 Bb1:2 Bb2:2 Bb1:2', pump('A1', 'A2'), pump('D2', 'D3')]) },
        { wave: 'noise', gain: 0.34, notes: rep('k:4 k:4 k:4 k:2 k:2', 15) + ' k:4 k:4 s:4 s:2 s:2' }
      ]
    },
    // The arena fight: a driving tune in E minor, 16 bars.
    battle: {
      bpm: 160, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.38, notes: bars([
          'E5:2 E5:2 -:2 E5:2 G5:2 F#5:2 E5:4', 'D5:2 B4:2 D5:2 E5:2 D5:4 B4:4', 'C5:2 C5:2 -:2 C5:2 E5:2 D5:2 C5:4', 'B4:4 D#5:4 F#5:4 B5:4',
          'E5:2 E5:2 -:2 E5:2 G5:2 F#5:2 E5:4', 'G5:2 F#5:2 G5:2 A5:2 B5:4 G5:4', 'A5:4 G5:4 F#5:4 D#5:4', 'E5:12 -:4',
          'B5:2 B5:2 -:2 B5:2 E6:2 D6:2 B5:4', 'C6:2 B5:2 A5:2 G5:2 A5:4 C6:4', 'D6:2 D6:2 -:2 D6:2 C6:2 A5:2 D6:4', 'B5:4 A5:4 G5:4 F#5:4',
          'E6:4 D6:4 C6:4 B5:4', 'A5:4 C6:4 E6:4 C6:4', 'B5:2 A5:2 G5:2 F#5:2 D#5:4 F#5:4', 'E5:8 -:2 B4:2 D5:2 D#5:2']) },
        { wave: 'pulse12', gain: 0.16, notes: bars([
          stab('G4', 'B4'), stab('G4', 'B4'), stab('E4', 'G4'), stab('D#4', 'F#4'),
          stab('G4', 'B4'), stab('G4', 'B4'), '-:2 C4:2 -:2 E4:2 -:2 D#4:2 -:2 F#4:2', stab('G4', 'B4'),
          stab('G4', 'B4'), stab('E4', 'G4'), stab('F#4', 'A4'), stab('D#4', 'F#4'),
          stab('E4', 'G4'), stab('C4', 'E4'), stab('D#4', 'F#4'), stab('G4', 'B4')]) },
        { wave: 'triangle', gain: 0.9, notes: bars([
          pump('E2', 'E3'), pump('E2', 'E3'), pump('C2', 'C3'), pump('B1', 'B2'),
          pump('E2', 'E3'), pump('G2', 'G3'), 'A2:2 A2:2 A3:2 A2:2 B1:2 B1:2 B2:2 B1:2', pump('E2', 'E3'),
          pump('E2', 'E3'), pump('C2', 'C3'), pump('D2', 'D3'), pump('B1', 'B2'),
          pump('C2', 'C3'), pump('A2', 'A3'), pump('B1', 'B2'), pump('E2', 'E3')]) },
        { wave: 'noise', gain: 0.42, notes: rep('k:2 h:2 s:2 h:2', 30) + ' k:2 h:2 s:2 h:2 s:2 s:2 s:2 s:2' }
      ]
    },
    // The boss: a snarling tune in D minor with a chromatic tremolo, 16 bars.
    boss: {
      bpm: 150, loop: true,
      voices: [
        { wave: 'pulse25', gain: 0.38, notes: bars([
          'D5:2 D5:2 D5:2 F5:2 E5:2 D#5:2 D5:4', 'A4:4 D5:4 C#5:4 D5:4', 'Bb4:2 Bb4:2 Bb4:2 D5:2 C5:2 B4:2 Bb4:4', 'A4:4 C#5:4 E5:4 G5:4',
          'F5:2 F5:2 F5:2 A5:2 G5:2 F#5:2 F5:4', 'G5:4 Bb5:4 A5:4 G5:4', 'Eb5:4 D5:4 C#5:4 E5:4', 'D5:12 -:4',
          'A5:2 A5:2 A5:2 D6:2 C6:2 B5:2 Bb5:4', 'G5:4 Bb5:4 D6:4 G5:4', 'F5:2 F5:2 F5:2 Bb5:2 A5:2 G#5:2 G5:4', 'E5:4 C#5:4 A5:4 E5:4',
          'D6:4 C6:4 Bb5:4 A5:4', 'G5:4 Bb5:4 Eb6:4 Bb5:4', 'A5:2 G5:2 F5:2 E5:2 C#5:4 E5:4', 'D5:8 -:2 A4:2 C5:2 C#5:2']) },
        { wave: 'pulse12', gain: 0.15, notes: bars([
          rep('A4:2 G#4:2', 4), rep('A4:2 G#4:2', 4), rep('F4:2 E4:2', 4), rep('E4:2 D#4:2', 4),
          rep('A4:2 G#4:2', 4), rep('D4:2 C#4:2', 4), 'Bb4:2 A4:2 Bb4:2 A4:2 E4:2 D#4:2 E4:2 D#4:2', rep('A4:2 G#4:2', 4),
          rep('A4:2 G#4:2', 4), rep('D4:2 C#4:2', 4), rep('F4:2 E4:2', 4), rep('E4:2 D#4:2', 4),
          rep('A4:2 G#4:2', 4), rep('Bb4:2 A4:2', 4), rep('E4:2 D#4:2', 4), rep('A4:2 G#4:2', 4)]) },
        { wave: 'triangle', gain: 0.9, notes: bars([
          pump('D2', 'D3'), pump('D2', 'D3'), pump('Bb1', 'Bb2'), pump('A1', 'A2'),
          pump('D2', 'D3'), pump('G1', 'G2'), 'Eb2:2 Eb2:2 Eb3:2 Eb2:2 A1:2 A1:2 A2:2 A1:2', pump('D2', 'D3'),
          pump('D2', 'D3'), pump('G1', 'G2'), pump('Bb1', 'Bb2'), pump('A1', 'A2'),
          pump('D2', 'D3'), pump('Eb2', 'Eb3'), pump('A1', 'A2'), pump('D2', 'D3')]) },
        { wave: 'noise', gain: 0.42, notes: rep('k:2 k:2 s:2 h:2', 30) + ' k:2 k:2 s:2 h:2 s:2 s:2 k:2 s:2' }
      ]
    },
    // Jingles: played once.
    levelup: {
      bpm: 150, loop: false,
      voices: [
        { wave: 'pulse25', gain: 0.42, notes: 'G4:2 C5:2 E5:2 G5:4 E5:2 G5:2 C6:12' },
        { wave: 'pulse12', gain: 0.18, notes: 'E4:2 G4:2 C5:2 E5:4 C5:2 E5:2 E5:12' },
        { wave: 'triangle', gain: 0.85, notes: 'C3:4 G3:4 E3:2 G3:2 C3:14' }
      ]
    },
    victory: {
      bpm: 132, loop: false,
      voices: [
        { wave: 'pulse25', gain: 0.42, notes: 'E5:2 G5:2 C6:4 B5:2 A5:2 G5:4 A5:2 B5:2 C6:2 D6:2 E6:12' },
        { wave: 'pulse12', gain: 0.2, notes: 'C5:2 E5:2 G5:4 G5:2 F5:2 E5:4 F5:2 G5:2 A5:2 B5:2 C6:12' },
        { wave: 'triangle', gain: 0.85, notes: 'C3:8 F3:8 G3:8 C3:12' },
        { wave: 'noise', gain: 0.3, notes: 'k:2 k:2 s:4 k:2 k:2 s:4 k:2 k:2 k:2 k:2 s:12' }
      ]
    },
    // A new best time: a longer fanfare that climbs.
    record: {
      bpm: 140, loop: false,
      voices: [
        { wave: 'pulse25', gain: 0.42, notes: 'C5:2 E5:2 G5:2 C6:2 E6:6 D6:2 C6:2 D6:2 E6:12' },
        { wave: 'pulse12', gain: 0.2, notes: 'E4:2 G4:2 C5:2 E5:2 G5:6 F5:2 E5:2 F5:2 G5:12' },
        { wave: 'triangle', gain: 0.85, notes: 'C3:4 C3:4 G3:4 G3:4 F3:4 G3:4 C3:8' },
        { wave: 'noise', gain: 0.3, notes: 'k:2 k:2 k:2 k:2 s:8 k:4 k:4 s:8' }
      ]
    },
    // A rank climbed: a quick run up the scale.
    rankup: {
      bpm: 150, loop: false,
      voices: [
        { wave: 'pulse25', gain: 0.42, notes: 'D5:2 E5:2 F#5:2 G5:2 A5:2 B5:2 C6:2 D6:10' },
        { wave: 'pulse12', gain: 0.2, notes: 'B4:2 C5:2 D5:2 E5:2 F#5:2 G5:2 A5:2 B5:10' },
        { wave: 'triangle', gain: 0.85, notes: 'G2:8 D3:8 G3:8' }
      ]
    },
    gameover: {
      bpm: 90, loop: false,
      voices: [
        { wave: 'pulse25', gain: 0.42, notes: 'E5:4 D#5:4 D5:4 C#5:12' },
        { wave: 'pulse12', gain: 0.2, notes: 'C5:4 B4:4 Bb4:4 A4:12' },
        { wave: 'triangle', gain: 0.85, notes: 'A2:8 G#2:8 G2:8' }
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
  // gain, the pulse waves and the noise buffer. The live rig is built on the
  // first unlock; render() builds a throwaway offline one for the tests.
  var rig = null;
  var enabled = true;
  var current = null;      // {name, gain, timer}
  var wanted = null;       // the track to play once sound is unlocked

  function makeRig(ac) {
    var r = { ctx: ac, master: ac.createGain(), waves: {}, noise: null };
    r.master.gain.value = 0.16;
    r.master.connect(ac.destination);
    // Pulse waves with 12.5% and 25% duty, the classic 8-bit timbres.
    [['pulse12', 0.125], ['pulse25', 0.25]].forEach(function (w) {
      var n = 32, re = new Float32Array(n), im = new Float32Array(n);
      for (var k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * w[1]);
      r.waves[w[0]] = ac.createPeriodicWave(re, im);
    });
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
    else o.type = wave === 'triangle' ? 'triangle' : wave === 'sawtooth' ? 'sawtooth' : 'square';
    o.frequency.setValueAtTime(f, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, t0 + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    if (env === 'pluck') g.gain.exponentialRampToValueAtTime(gain * 0.25, t0 + Math.max(0.02, dur - 0.03));
    else g.gain.setValueAtTime(gain, t0 + Math.max(0.01, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function drum(r, kind, t0, gain, dest) {
    var ctx = r.ctx;
    if (kind === 'k') { osc(r, 'triangle', 150, t0, 0.12, gain * 1.4, dest, 40); return; }
    var src = ctx.createBufferSource();
    src.buffer = r.noise;
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
  var SE = {
    blip: function (r, t, m) { osc(r, 'pulse25', 1320, t, 0.025, 0.25, m); },
    cursor: function (r, t, m) { osc(r, 'pulse25', 990, t, 0.04, 0.35, m); },
    prefix: function (r, t, m) { osc(r, 'pulse12', 660, t, 0.04, 0.3, m); osc(r, 'pulse12', 990, t + 0.04, 0.05, 0.3, m); },
    cmd: function (r, t, m) { [784, 988, 1175].forEach(function (f, i) { osc(r, 'pulse25', f, t + i * 0.035, 0.05, 0.3, m); }); },
    // A wrong key: a short buzz that drops.
    miss: function (r, t, m) { osc(r, 'square', 196, t, 0.1, 0.32, m, 110); osc(r, 'square', 147, t + 0.1, 0.12, 0.28, m, 80); },
    // A question answered: a slash, then a two-note "ting" that climbs a
    // semitone per hit in a streak, up to an octave.
    hit: function (r, t, m, streak) {
      var up = Math.min(Math.max(streak || 1, 1) - 1, 12);
      var f = 784 * Math.pow(2, up / 12);
      drum(r, 's', t, 1.2, m);
      osc(r, 'square', 440, t, 0.06, 0.25, m, 110);
      osc(r, 'pulse25', f, t + 0.02, 0.05, 0.3, m);
      osc(r, 'pulse25', f * 1.5, t + 0.07, 0.1, 0.3, m);
      // Every fifth hit in a row adds a high chime.
      if (streak && streak % 5 === 0) osc(r, 'pulse12', f * 2, t + 0.12, 0.14, 0.25, m);
    },
    open: function (r, t, m) { [523, 659, 784, 1047].forEach(function (f, i) { osc(r, 'triangle', f, t + i * 0.07, 0.12, 0.7, m); }); },
    hurt: function (r, t, m) { drum(r, 's', t, 1.6, m); drum(r, 'k', t + 0.05, 1.2, m); osc(r, 'square', 330, t, 0.2, 0.3, m, 90); },
    // The clock ran out: two thuds and a slide down.
    timeout: function (r, t, m) { drum(r, 'k', t, 1.4, m); drum(r, 'k', t + 0.12, 1.4, m); osc(r, 'sawtooth', 330, t + 0.05, 0.3, 0.18, m, 110); },
    tick: function (r, t, m) { osc(r, 'pulse12', 1760, t, 0.02, 0.2, m); },
    // The fight starts.
    go: function (r, t, m) { [1047, 1319, 1568].forEach(function (f, i) { osc(r, 'pulse25', f, t + i * 0.06, i === 2 ? 0.18 : 0.06, 0.32, m); }); drum(r, 's', t + 0.12, 1, m); }
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
      parse(v.notes).forEach(function (e) { s += e.len; if (e.n !== '-' && !/^[ksh]$/.test(e.n) && !freq(e.n)) bad.push(e.n); });
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
