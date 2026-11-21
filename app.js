import * as THREE from "three";
import { FilesetResolver, HandLandmarker } from
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById("cam");
const stageEl = document.getElementById("stage");
const glCanvas = document.getElementById("glCanvas");
const statusEl = document.getElementById("status");
const calibrateBtn = document.getElementById("calibrateBtn");
const recordBtn = document.getElementById("recordBtn");
const exitRecordBtn = document.getElementById("exitRecordBtn");
const camBtn = document.getElementById("camBtn");
const pinBtn = document.getElementById("pinBtn");
const scaleBtn = document.getElementById("scaleBtn");
const voiceBtn = document.getElementById("voiceBtn");
const strumBtn = document.getElementById("strumBtn");
const reelBtn = document.getElementById("reelBtn");
const loverBoyBtn = document.getElementById("loverBoyBtn");
const quoteBtn = document.getElementById("quoteBtn");
const midiBtn = document.getElementById("midiBtn");
const musicBtn = document.getElementById("musicBtn");
const clearBtn = document.getElementById("clearBtn");

const SCALES = [
  { name: "Ambasel", notes: [0, 1, 5, 7, 8] },
  { name: "Minor Pent", notes: [0, 3, 5, 7, 10] },
  { name: "Dorian", notes: [0, 2, 3, 5, 7, 9, 10] },
  { name: "Hirajoshi", notes: [0, 2, 3, 7, 8] },
  { name: "Lover Maj7", notes: [0, 2, 4, 7, 9, 11] }
];
let scaleIndex = 0;
const BASE_FREQ = 110;
const BASE_MIDI = 45;

const FINGER_CHORDS = [
  [0, 7, 12],
  [0, 3, 7, 10],
  [0, 5, 7, 12],
  [0, 7, 8, 12],
  [0, 4, 7, 11]
];

const LOVER_BOY_CHORDS = [
  [0, 4, 7, 11],   // Maj7
  [0, 3, 7, 10],   // Min7
  [0, 4, 7, 11],   // Maj7
  [0, 3, 7, 10],   // Min7
  [0, 4, 7, 9]     // 6th
];

// Laid-back 4-bar Lover Boy progression (E / C#m / B / G#m style feel in semitones from A2)
const LOVER_BOY_PROGRESSION = [
  { rootSemi: 7, chord: [0, 4, 7, 11] },
  { rootSemi: 4, chord: [0, 3, 7, 10] },
  { rootSemi: 2, chord: [0, 4, 7, 11] },
  { rootSemi: -1, chord: [0, 3, 7, 10] }
];

const FINGER_TIPS = [4, 8, 12, 16, 20];

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]
];

const STRING_COLORS = [0xf8fafc, 0x67e8f9, 0xf472b6, 0xfef08a, 0x86efac];
const VOICES = ["hybrid", "guitar", "piano"];

// --- 1. Web Audio + Lover Boy Loop + Optional Web MIDI Output ---
let audioCtx = null;
let masterFilter = null;
let masterBus = null;
let holdOsc = null;
let holdGain = null;
let holdFilter = null;
let backingEnabled = true;
let arpMode = true;
let reelMode = false;
let loverBoyEnabled = false;
let loverBoyTimer = null;
let loverBoyStep = 0;
let currentStream = null;
let videoDevices = [];
let cameraDeviceIndex = 0;
let voiceIndex = 0;
let lastFreq = 165;
let midiAccess = null;
let midiEnabled = false;
let activeMidiNotes = [];

function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass({ latencyHint: "interactive" });

    masterFilter = audioCtx.createBiquadFilter();
    masterFilter.type = "lowpass";
    masterFilter.frequency.value = 4400;
    masterFilter.Q.value = 1.6;

    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;

    masterBus = audioCtx.createGain();
    masterBus.gain.value = 0.85;

    masterFilter.connect(comp);
    comp.connect(masterBus);
    masterBus.connect(audioCtx.destination);

    holdFilter = audioCtx.createBiquadFilter();
    holdFilter.type = "lowpass";
    holdFilter.frequency.value = 850;

    holdGain = audioCtx.createGain();
    holdGain.gain.value = 0.0001;

    holdOsc = audioCtx.createOscillator();
    holdOsc.type = "triangle";
    holdOsc.frequency.value = BASE_FREQ;

    holdOsc.connect(holdFilter);
    holdFilter.connect(holdGain);
    holdGain.connect(masterBus);
    holdOsc.start();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function triggerLoverBoyBar() {
  if (!loverBoyEnabled || !audioCtx || !masterBus) return;
  const now = audioCtx.currentTime;
  const bar = LOVER_BOY_PROGRESSION[loverBoyStep % LOVER_BOY_PROGRESSION.length];
  loverBoyStep++;

  const rootFreq = BASE_FREQ * Math.pow(2, bar.rootSemi / 12);
  const bassFreq = Math.max(55, rootFreq * 0.5);

  // Soft warm bass note
  const bassOsc = audioCtx.createOscillator();
  bassOsc.type = "triangle";
  bassOsc.frequency.setValueAtTime(bassFreq, now);
  bassOsc.frequency.exponentialRampToValueAtTime(bassFreq * 0.99, now + 1.35);

  const bassGain = audioCtx.createGain();
  bassGain.gain.setValueAtTime(0.0001, now);
  bassGain.gain.linearRampToValueAtTime(0.11, now + 0.04);
  bassGain.gain.exponentialRampToValueAtTime(0.0006, now + 1.4);

  bassOsc.connect(bassGain);
  bassGain.connect(masterBus);
  bassOsc.start(now);
  bassOsc.stop(now + 1.45);

  // Dreamy Rhodes-like chord pad
  bar.chord.forEach((semi, idx) => {
    const nFreq = rootFreq * Math.pow(2, semi / 12);
    const osc = audioCtx.createOscillator();
    osc.type = idx % 2 === 0 ? "sine" : "triangle";
    osc.frequency.setValueAtTime(nFreq, now + idx * 0.045);

    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, now + idx * 0.045);
    g.gain.linearRampToValueAtTime(0.042, now + idx * 0.045 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0004, now + 1.45);

    osc.connect(g);
    g.connect(masterFilter);
    osc.start(now + idx * 0.045);
    osc.stop(now + 1.5);
  });
}

function toggleLoverBoy() {
  initAudio();
  loverBoyEnabled = !loverBoyEnabled;
  if (loverBoyBtn) {
    loverBoyBtn.textContent = loverBoyEnabled ? "Lover Boy: On" : "Lover Boy: Off";
    loverBoyBtn.classList.toggle("active", loverBoyEnabled);
  }
  if (loverBoyTimer) {
    clearInterval(loverBoyTimer);
    loverBoyTimer = null;
  }
  if (loverBoyEnabled) {
    loverBoyStep = 0;
    triggerLoverBoyBar();
    loverBoyTimer = setInterval(triggerLoverBoyBar, 1450);
    statusEl.textContent = "Lover Boy groove active — play along with smooth chords!";
  } else {
    statusEl.textContent = "Lover Boy groove off.";
  }
}

if (loverBoyBtn) {
  loverBoyBtn.addEventListener("click", toggleLoverBoy);
}

function updateFilterByHeight(normY) {
  if (!audioCtx || !masterFilter) return;
  const brightness = Math.min(1, Math.max(0, 1 - normY));
  const cutoff = 1100 + brightness * 4600;
  masterFilter.frequency.setTargetAtTime(cutoff, audioCtx.currentTime, 0.05);
}

function updateHoldSound(active, stretch) {
  if (!audioCtx || !holdOsc || !holdGain || !holdFilter) return;
  const now = audioCtx.currentTime;
  const freq = stretchToFreq(stretch);
  holdOsc.frequency.setTargetAtTime(freq, now, 0.05);
  holdFilter.frequency.setTargetAtTime(420 + stretch * 1400, now, 0.06);
  const targetGain = active && stretch > 0.18 ? 0.03 + stretch * 0.04 : 0.0001;
  holdGain.gain.setTargetAtTime(targetGain, now, 0.06);
}

function sendMidiChord(semitones, velocity = 96) {
  if (!midiEnabled || !midiAccess) return;
  const clampedVel = Math.min(127, Math.max(20, Math.round(velocity)));

  for (const n of activeMidiNotes) {
    for (const out of midiAccess.outputs.values()) {
      out.send([0x80, n, 0]);
    }
  }
  activeMidiNotes = [];

  for (const semi of semitones) {
    const midiNote = Math.min(108, Math.max(24, BASE_MIDI + semi));
    activeMidiNotes.push(midiNote);
    for (const out of midiAccess.outputs.values()) {
      out.send([0x90, midiNote, clampedVel]);
    }
  }
}

if (midiBtn) {
  midiBtn.addEventListener("click", async () => {
    if (!midiEnabled) {
      if (!navigator.requestMIDIAccess) {
        statusEl.textContent = "Web MIDI not supported in this browser.";
        return;
      }
      try {
        midiAccess = await navigator.requestMIDIAccess();
        midiEnabled = midiAccess.outputs.size > 0;
        midiBtn.textContent = midiEnabled ? "MIDI: On" : "MIDI: No Port";
        midiBtn.classList.toggle("active", midiEnabled);
        statusEl.textContent = midiEnabled
          ? `Connected to ${midiAccess.outputs.size} MIDI output port(s).`
          : "No MIDI output ports found (create an ALSA/PipeWire virtual MIDI port to route).";
      } catch (err) {
        statusEl.textContent = `MIDI error: ${err.message}`;
      }
    } else {
      sendMidiChord([]);
      midiEnabled = false;
      midiBtn.textContent = "MIDI: Off";
      midiBtn.classList.remove("active");
    }
  });
}

function cycleScale() {
  scaleIndex = (scaleIndex + 1) % SCALES.length;
  if (scaleBtn) scaleBtn.textContent = `Scale: ${SCALES[scaleIndex].name}`;
}

function cycleVoice() {
  initAudio();
  voiceIndex = (voiceIndex + 1) % VOICES.length;
  const label = VOICES[voiceIndex][0].toUpperCase() + VOICES[voiceIndex].slice(1);
  if (voiceBtn) voiceBtn.textContent = `Voice: ${label}`;
}

function toggleReelFrame() {
  reelMode = !reelMode;
  stageEl.classList.toggle("reel-mode", reelMode);
  if (reelBtn) reelBtn.textContent = reelMode ? "Frame: 9:16" : "Frame: 4:3";
}

if (scaleBtn) scaleBtn.addEventListener("click", cycleScale);
if (voiceBtn) voiceBtn.addEventListener("click", cycleVoice);
if (reelBtn) reelBtn.addEventListener("click", toggleReelFrame);

let recordViewEnabled = false;

function setRecordView(enabled) {
  recordViewEnabled = Boolean(enabled);
  document.body.classList.toggle("record-only", recordViewEnabled);
  document.body.classList.toggle("reel-stage", recordViewEnabled && Boolean(reelMode));
  if (recordBtn) {
    recordBtn.textContent = recordViewEnabled ? "Show UI" : "Record View";
    recordBtn.classList.toggle("active", recordViewEnabled);
  }
}

function toggleRecordView() {
  setRecordView(!recordViewEnabled);
}

if (recordBtn) {
  recordBtn.addEventListener("click", toggleRecordView);
}
if (exitRecordBtn) {
  exitRecordBtn.addEventListener("click", () => setRecordView(false));
}


if (strumBtn) {
  strumBtn.addEventListener("click", () => {
    arpMode = !arpMode;
    strumBtn.textContent = arpMode ? "Strum: Arp" : "Strum: Block";
  });
}

if (musicBtn) {
  musicBtn.addEventListener("click", () => {
    initAudio();
    backingEnabled = !backingEnabled;
    musicBtn.textContent = backingEnabled ? "Overtones: On" : "Overtones: Off";
  });
}

function stretchToStep(stretch) {
  if (loverBoyEnabled) {
    const bar = LOVER_BOY_PROGRESSION[(loverBoyStep + 3) % LOVER_BOY_PROGRESSION.length];
    const extraSemi = Math.round(stretch * 7);
    const semitone = bar.rootSemi + extraSemi;
    return { freq: BASE_FREQ * Math.pow(2, semitone / 12), semitone };
  }
  const notes = SCALES[scaleIndex].notes;
  const totalSteps = notes.length * 2;
  const idx = Math.min(
    totalSteps - 1,
    Math.max(0, Math.round(stretch * (totalSteps - 1)))
  );
  const octave = Math.floor(idx / notes.length);
  const semitone = notes[idx % notes.length] + octave * 12;
  const freq = BASE_FREQ * Math.pow(2, semitone / 12);
  return { freq, semitone };
}

function stretchToFreq(stretch) {
  return stretchToStep(stretch).freq;
}

function playDeepBass(freq, startTime, duration, velocity) {
  const bass = audioCtx.createOscillator();
  const sub = audioCtx.createOscillator();
  bass.type = "sawtooth";
  sub.type = "sine";

  const bassFreq = Math.max(55, freq * 0.5);
  bass.frequency.setValueAtTime(bassFreq * 1.15, startTime);
  bass.frequency.exponentialRampToValueAtTime(bassFreq, startTime + 0.12);
  bass.frequency.exponentialRampToValueAtTime(bassFreq * 0.94, startTime + duration);

  sub.frequency.setValueAtTime(bassFreq, startTime);
  sub.frequency.exponentialRampToValueAtTime(bassFreq * 0.96, startTime + duration);

  const lpf = audioCtx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.setValueAtTime(Math.min(950, bassFreq * 4.5), startTime);
  lpf.frequency.exponentialRampToValueAtTime(140, startTime + duration);

  const env = audioCtx.createGain();
  env.gain.setValueAtTime(0.0001, startTime);
  env.gain.linearRampToValueAtTime(velocity, startTime + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0008, startTime + duration);

  bass.connect(lpf);
  sub.connect(lpf);
  lpf.connect(env);
  env.connect(masterBus);

  bass.start(startTime);
  sub.start(startTime);
  bass.stop(startTime + duration + 0.03);
  sub.stop(startTime + duration + 0.03);
}

function playGuitarNote(freq, startTime, duration, velocity) {
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  osc1.type = "triangle";
  osc2.type = "sawtooth";
  osc1.frequency.setValueAtTime(freq, startTime);
  osc2.frequency.setValueAtTime(freq * 1.004, startTime);

  const bodyFilter = audioCtx.createBiquadFilter();
  bodyFilter.type = "lowpass";
  bodyFilter.frequency.setValueAtTime(Math.min(4400, freq * 6.5), startTime);
  bodyFilter.frequency.exponentialRampToValueAtTime(Math.max(180, freq * 1.3), startTime + duration);

  const env = audioCtx.createGain();
  env.gain.setValueAtTime(0.0001, startTime);
  env.gain.linearRampToValueAtTime(velocity, startTime + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0007, startTime + duration);

  osc1.connect(bodyFilter);
  osc2.connect(bodyFilter);
  bodyFilter.connect(env);
  env.connect(masterBus);

  osc1.start(startTime);
  osc2.start(startTime);
  osc1.stop(startTime + duration + 0.02);
  osc2.stop(startTime + duration + 0.02);
}

function playPianoNote(freq, startTime, duration, velocity) {
  const fund = audioCtx.createOscillator();
  const overtone = audioCtx.createOscillator();
  fund.type = "sine";
  overtone.type = "triangle";
  fund.frequency.setValueAtTime(freq, startTime);
  overtone.frequency.setValueAtTime(freq * 2, startTime);

  const overGain = audioCtx.createGain();
  overGain.gain.setValueAtTime(velocity * 0.35, startTime);
  overGain.gain.exponentialRampToValueAtTime(0.0005, startTime + duration * 0.45);

  const env = audioCtx.createGain();
  env.gain.setValueAtTime(0.0001, startTime);
  env.gain.linearRampToValueAtTime(velocity, startTime + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0006, startTime + duration);

  fund.connect(env);
  overtone.connect(overGain);
  overGain.connect(env);
  env.connect(masterBus);

  fund.start(startTime);
  overtone.start(startTime);
  fund.stop(startTime + duration + 0.02);
  overtone.stop(startTime + duration + 0.02);
}

function playFingerChord(stretch, fingerIdx = 1) {
  initAudio();
  const now = audioCtx.currentTime;
  const { freq: rootFreq, semitone: rootSemi } = stretchToStep(stretch);
  const chordSet = loverBoyEnabled ? LOVER_BOY_CHORDS : FINGER_CHORDS;
  const intervals = chordSet[fingerIdx % chordSet.length];
  const voice = VOICES[voiceIndex];
  const strumStep = arpMode ? 0.042 : 0.0;

  sendMidiChord(
    intervals.map((s) => rootSemi + s),
    65 + stretch * 55
  );

  intervals.forEach((semi, i) => {
    const noteFreq = rootFreq * Math.pow(2, semi / 12);
    const noteStart = now + i * strumStep;
    const noteGain = (0.15 + 0.1 * Math.min(1, stretch)) / Math.sqrt(intervals.length);

    if (voice === "guitar") {
      playGuitarNote(noteFreq, noteStart, 1.65, noteGain * 1.15);
    } else if (voice === "piano") {
      playPianoNote(noteFreq, noteStart, 1.75, noteGain * 1.2);
    } else {
      playGuitarNote(noteFreq, noteStart, 1.5, noteGain * 0.82);
      playPianoNote(noteFreq * 2, noteStart + 0.02, 1.4, noteGain * 0.46);
    }
  });
}

function pluckString(stretch, fingerIdx = 1) {
  initAudio();
  const now = audioCtx.currentTime;
  const targetFreq = stretchToFreq(stretch);
  const slideStart = lastFreq * (0.82 + 0.18 * Math.min(1, stretch));
  const slideEnd = targetFreq * 0.96;
  const duration = 2.0;
  lastFreq = targetFreq;

  const voice = VOICES[voiceIndex];
  if (voice === "guitar" || voice === "piano") {
    playFingerChord(stretch, fingerIdx);
    if (backingEnabled) playDeepBass(targetFreq, now, 1.8, 0.2);
    return;
  }

  const oscPrimary = audioCtx.createOscillator();
  oscPrimary.type = "sawtooth";
  oscPrimary.frequency.setValueAtTime(slideStart, now);
  oscPrimary.frequency.exponentialRampToValueAtTime(targetFreq, now + 0.18);
  oscPrimary.frequency.exponentialRampToValueAtTime(slideEnd, now + duration);

  const oscWarm = audioCtx.createOscillator();
  oscWarm.type = "triangle";
  oscWarm.frequency.setValueAtTime(slideStart * 0.5, now);
  oscWarm.frequency.exponentialRampToValueAtTime(targetFreq * 0.5, now + 0.2);
  oscWarm.frequency.exponentialRampToValueAtTime(slideEnd * 0.5, now + duration);

  const env = audioCtx.createGain();
  const peak = 0.22 + 0.2 * Math.min(1, Math.max(0.15, stretch));
  env.gain.setValueAtTime(0.0001, now);
  env.gain.linearRampToValueAtTime(peak, now + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0008, now + duration);

  oscPrimary.connect(env);
  oscWarm.connect(env);
  env.connect(masterFilter);

  oscPrimary.start(now);
  oscWarm.start(now);
  oscPrimary.stop(now + duration + 0.02);
  oscWarm.stop(now + duration + 0.02);

  playDeepBass(targetFreq, now, 1.9, 0.22);
  playFingerChord(stretch * 0.85 + 0.15, fingerIdx);
  playQuoteStab(targetFreq, now, stretch);
}

// --- 2. High-DPI Three.js Renderer ---
const width = glCanvas.width;
const height = glCanvas.height;
const uiScale = width / 640;

const renderer = new THREE.WebGLRenderer({
  canvas: glCanvas,
  alpha: true,
  antialias: true,
  powerPreference: "high-performance"
});
renderer.setSize(width, height, false);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, width, 0, height, -10, 10);

function makeDotTexture(innerHex, outerHex) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  grad.addColorStop(0.0, innerHex);
  grad.addColorStop(0.55, innerHex);
  grad.addColorStop(0.75, outerHex);
  grad.addColorStop(1.0, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeRingTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  g.strokeStyle = "#ffffff";
  g.lineWidth = 7;
  g.beginPath();
  g.arc(64, 64, 44, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

function makeGlowRibbonTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0.0, "rgba(255,255,255,0.0)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.38)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.65, "rgba(255,255,255,0.38)");
  grad.addColorStop(1.0, "rgba(255,255,255,0.0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const redDotTex = makeDotTexture("#ef4444", "rgba(239,68,68,0.22)");
const sparkTex = makeDotTexture("#fef08a", "rgba(255,255,255,0)");
const tipRingTex = makeRingTexture();
const ribbonTex = makeGlowRibbonTexture();

const TICK_COUNT = 14;
const WAVE_SEGMENTS = 48;
const DASH_SEGMENTS = 18;

function createStringGroup(colorHex, dashed = false) {
  const group = new THREE.Group();

  let glowRibbon = null;
  let glowMat = null;
  if (!dashed) {
    const ribbonGeo = new THREE.PlaneGeometry(1, 1);
    glowMat = new THREE.MeshBasicMaterial({
      map: ribbonTex,
      color: colorHex,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    glowRibbon = new THREE.Mesh(ribbonGeo, glowMat);
    group.add(glowRibbon);
  }

  const lineVertCount = dashed ? DASH_SEGMENTS * 2 : 2;
  const linePos = new Float32Array(lineVertCount * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: dashed ? 0.85 : 0.88
  });
  const baseLine = dashed
    ? new THREE.LineSegments(lineGeo, lineMat)
    : new THREE.Line(lineGeo, lineMat);
  group.add(baseLine);

  const tickPos = new Float32Array(TICK_COUNT * 2 * 3);
  const tickGeo = new THREE.BufferGeometry();
  tickGeo.setAttribute("position", new THREE.BufferAttribute(tickPos, 3));
  const tickMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.82
  });
  const ticks = new THREE.LineSegments(tickGeo, tickMat);
  group.add(ticks);

  const wavePos = new Float32Array((WAVE_SEGMENTS + 1) * 3);
  const waveGeo = new THREE.BufferGeometry();
  waveGeo.setAttribute("position", new THREE.BufferAttribute(wavePos, 3));
  const waveMat = new THREE.LineBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: dashed ? 0.0 : 0.96,
    blending: THREE.AdditiveBlending
  });
  const waveLine = new THREE.Line(waveGeo, waveMat);
  group.add(waveLine);

  return { group, dashed, glowRibbon, glowMat, lineGeo, lineMat, tickGeo, tickMat, waveGeo, waveMat };
}

function updateStringGeometry(sg, x1, y1, x2, y2, vibeAmp, nowMs, phaseOffset = 0) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  const scaledVibe = vibeAmp * uiScale;

  if (sg.glowRibbon) {
    sg.glowRibbon.position.set((x1 + x2) * 0.5, (y1 + y2) * 0.5, 0);
    sg.glowRibbon.rotation.z = Math.atan2(dy, dx);
    sg.glowRibbon.scale.set(len, (14 + vibeAmp * 1.3) * uiScale, 1);
  }

  const lAttr = sg.lineGeo.getAttribute("position");
  if (sg.dashed) {
    for (let d = 0; d < DASH_SEGMENTS; d++) {
      const t0 = d / DASH_SEGMENTS;
      const t1 = Math.min(1, t0 + 0.52 / DASH_SEGMENTS);
      const idx = d * 6;
      lAttr.array[idx] = x1 + dx * t0;
      lAttr.array[idx + 1] = y1 + dy * t0;
      lAttr.array[idx + 2] = 0;
      lAttr.array[idx + 3] = x1 + dx * t1;
      lAttr.array[idx + 4] = y1 + dy * t1;
      lAttr.array[idx + 5] = 0;
    }
  } else {
    lAttr.array[0] = x1; lAttr.array[1] = y1; lAttr.array[2] = 0;
    lAttr.array[3] = x2; lAttr.array[4] = y2; lAttr.array[5] = 0;
  }
  lAttr.needsUpdate = true;

  const tAttr = sg.tickGeo.getAttribute("position");
  for (let i = 0; i < TICK_COUNT; i++) {
    const frac = (i + 1) / (TICK_COUNT + 1);
    const cx = x1 + dx * frac;
    const cy = y1 + dy * frac;
    const tickHalf = (i % 3 === 2 ? 7 : 4) * uiScale;
    const idx = i * 6;
    tAttr.array[idx] = cx - nx * tickHalf;
    tAttr.array[idx + 1] = cy - ny * tickHalf;
    tAttr.array[idx + 2] = 0;
    tAttr.array[idx + 3] = cx + nx * tickHalf;
    tAttr.array[idx + 4] = cy + ny * tickHalf;
    tAttr.array[idx + 5] = 0;
  }
  tAttr.needsUpdate = true;

  const wAttr = sg.waveGeo.getAttribute("position");
  const freq = 0.025 * len;
  const speed = nowMs * 0.036 + phaseOffset;
  for (let s = 0; s <= WAVE_SEGMENTS; s++) {
    const u = s / WAVE_SEGMENTS;
    const env = Math.sin(u * Math.PI);
    const wave = Math.sin(u * freq - speed) * scaledVibe * env;
    const idx = s * 3;
    wAttr.array[idx] = x1 + dx * u + nx * wave;
    wAttr.array[idx + 1] = y1 + dy * u + ny * wave;
    wAttr.array[idx + 2] = 0;
  }
  wAttr.needsUpdate = true;
}

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const ccw = (p1x, p1y, p2x, p2y, p3x, p3y) =>
    (p3y - p1y) * (p2x - p1x) > (p2y - p1y) * (p3x - p1x);
  return (
    ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy) &&
    ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy)
  );
}

const MAX_HANDS = 2;
const hands = Array.from({ length: MAX_HANDS }, () => {
  const sg = createStringGroup(0xf8fafc, true);
  sg.group.visible = false;
  scene.add(sg.group);

  const fingerRings = FINGER_TIPS.map((_, fIdx) => {
    const ring = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tipRingTex,
        color: STRING_COLORS[fIdx % STRING_COLORS.length],
        transparent: true,
        opacity: fIdx < 2 ? 0.96 : 0.75
      })
    );
    const sz = (fIdx < 2 ? 22 : 14) * uiScale;
    ring.scale.set(sz, sz, 1);
    ring.visible = false;
    scene.add(ring);
    return ring;
  });

  const skelPos = new Float32Array(HAND_CONNECTIONS.length * 2 * 3);
  const skelGeo = new THREE.BufferGeometry();
  skelGeo.setAttribute("position", new THREE.BufferAttribute(skelPos, 3));
  const skelLines = new THREE.LineSegments(
    skelGeo,
    new THREE.LineBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.72 })
  );
  skelLines.visible = false;
  scene.add(skelLines);

  const jointPos = new Float32Array(21 * 3);
  const jointGeo = new THREE.BufferGeometry();
  jointGeo.setAttribute("position", new THREE.BufferAttribute(jointPos, 3));
  const jointPoints = new THREE.Points(
    jointGeo,
    new THREE.PointsMaterial({
      map: redDotTex,
      size: 10 * uiScale,
      transparent: true,
      opacity: 0.88
    })
  );
  jointPoints.frustumCulled = false;
  jointPoints.visible = false;
  scene.add(jointPoints);

  return {
    sg,
    fingerRings,
    skelGeo,
    skelLines,
    jointGeo,
    jointPoints,
    smoothSpan: null,
    prevSpan: null,
    prevTipX: null,
    prevTipY: null,
    prevFingerY: [null, null, null, null, null],
    maxStretch: 0,
    lastPluckTime: 0,
    vibeEnergy: 0
  };
});

const middleString = createStringGroup(0xf472b6, false);
middleString.group.visible = false;
scene.add(middleString.group);

let middleHeld = false;
let middlePinned = false;
let prevTwoHandSpan = null;
let lastMiddleToggleMs = 0;
let middleCoords = {
  x1: width * 0.22,
  y1: height * 0.5,
  x2: width * 0.78,
  y2: height * 0.5,
  stretch: 0.5,
  vibeEnergy: 0
};

function syncPinButtonLabel() {
  if (!pinBtn) return;
  pinBtn.textContent = middleHeld || middlePinned ? "Pin Middle: On" : "Pin Middle: Off";
}

function toggleMiddlePin() {
  initAudio();
  middlePinned = !middlePinned;
  middleHeld = middlePinned;
  syncPinButtonLabel();
  middleString.group.visible = middleHeld;
  if (middleHeld) {
    pluckString(0.55, 1);
    middleCoords.vibeEnergy = 12;
    spawnSparks(middleCoords.x1, middleCoords.y1, middleCoords.x2, middleCoords.y2, 12);
  }
}

if (pinBtn) {
  pinBtn.addEventListener("click", toggleMiddlePin);
}

const MAX_PLACED = 12;
const PLACED_MS = 25000;
const placedStrings = [];

function disposePlacedItem(item) {
  scene.remove(item.sg.group);
  if (item.sg.glowRibbon) {
    item.sg.glowRibbon.geometry.dispose();
    item.sg.glowMat.dispose();
  }
  item.sg.lineGeo.dispose();
  item.sg.tickGeo.dispose();
  item.sg.waveGeo.dispose();
  item.sg.lineMat.dispose();
  item.sg.tickMat.dispose();
  item.sg.waveMat.dispose();
}

function clearAllPlacedStrings() {
  while (placedStrings.length > 0) {
    disposePlacedItem(placedStrings.shift());
  }
}

if (clearBtn) {
  clearBtn.addEventListener("click", clearAllPlacedStrings);
}

window.addEventListener("keydown", (e) => {
  if (e.target && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === "c") clearAllPlacedStrings();
  else if (k === "m") toggleMiddlePin();
  else if (k === "v") cycleVoice();
  else if (k === "s") cycleScale();
  else if (k === "r") toggleReelFrame();
  else if (k === "q") toggleQuoteStab();
  else if (k === "l") toggleLoverBoy();
});

function addPlacedString(x1, y1, x2, y2, bornMs, colorHex) {
  if (placedStrings.length >= MAX_PLACED) {
    disposePlacedItem(placedStrings.shift());
  }
  const sg = createStringGroup(colorHex, false);
  scene.add(sg.group);
  placedStrings.push({ sg, x1, y1, x2, y2, bornMs, phase: Math.random() * 10 });
}

function updatePlacedStrings(nowMs) {
  for (let i = placedStrings.length - 1; i >= 0; i--) {
    const item = placedStrings[i];
    const age = (nowMs - item.bornMs) / PLACED_MS;
    if (age >= 1) {
      disposePlacedItem(item);
      placedStrings.splice(i, 1);
    } else {
      const fade = age < 0.85 ? 1 : 1 - (age - 0.85) / 0.15;
      const vibeAmp = Math.max(0, 10 * Math.pow(Math.max(0, 1 - age * 3.5), 2));
      updateStringGeometry(item.sg, item.x1, item.y1, item.x2, item.y2, vibeAmp, nowMs, item.phase);
      item.sg.lineMat.opacity = 0.86 * fade;
      item.sg.tickMat.opacity = 0.78 * fade;
      item.sg.waveMat.opacity = 0.94 * fade;
      if (item.sg.glowMat) item.sg.glowMat.opacity = 0.26 * fade;
    }
  }
}

const SPARK_COUNT = 72;
const sparks = Array.from({ length: SPARK_COUNT }, () => ({
  active: false,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  life: 0
}));
const sparkPos = new Float32Array(SPARK_COUNT * 3);
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
const sparkPoints = new THREE.Points(
  sparkGeo,
  new THREE.PointsMaterial({
    map: sparkTex,
    size: 11 * uiScale,
    transparent: true,
    opacity: 0.98,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
);
sparkPoints.frustumCulled = false;
scene.add(sparkPoints);

function spawnSparks(x1, y1, x2, y2, count) {
  let added = 0;
  for (const s of sparks) {
    if (!s.active) {
      const t = Math.random();
      s.x = x1 + (x2 - x1) * t;
      s.y = y1 + (y2 - y1) * t;
      const angle = Math.random() * Math.PI * 2;
      const speed = (1.4 + Math.random() * 4.2) * uiScale;
      s.vx = Math.cos(angle) * speed;
      s.vy = Math.sin(angle) * speed - 0.7 * uiScale;
      s.life = 1.0;
      s.active = true;
      if (++added >= count) break;
    }
  }
}

function updateSparks(dtMs) {
  const attr = sparkGeo.getAttribute("position");
  const step = dtMs / 16.67;
  for (let i = 0; i < SPARK_COUNT; i++) {
    const s = sparks[i];
    if (!s.active) {
      attr.array[i * 3] = -9999;
      attr.array[i * 3 + 1] = -9999;
      continue;
    }
    s.x += s.vx * step;
    s.y += s.vy * step;
    s.vy += 0.08 * uiScale * step;
    s.life -= 0.04 * step;
    if (s.life <= 0) {
      s.active = false;
      attr.array[i * 3] = -9999;
      attr.array[i * 3 + 1] = -9999;
    } else {
      attr.array[i * 3] = s.x;
      attr.array[i * 3 + 1] = s.y;
      attr.array[i * 3 + 2] = 0;
    }
  }
  attr.needsUpdate = true;
}

// --- 3. Gesture State Machine ---
let colorCounter = 0;
const COOLDOWN_MS = 180;

function updateHandGesture(handCtx, landmarks, nowMs) {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];

  const tx = thumbTip.x * width;
  const ty = thumbTip.y * height;
  const ix = indexTip.x * width;
  const iy = indexTip.y * height;

  updateFilterByHeight(landmarks[9].y);

  const spanPx = Math.hypot(ix - tx, iy - ty);
  if (handCtx.smoothSpan === null) {
    handCtx.smoothSpan = spanPx;
  } else {
    handCtx.smoothSpan += (spanPx - handCtx.smoothSpan) * 0.35;
  }
  const spanVel = handCtx.prevSpan === null ? 0 : handCtx.smoothSpan - handCtx.prevSpan;
  handCtx.prevSpan = handCtx.smoothSpan;

  const stretch = Math.min(1, Math.max(0.1, (handCtx.smoothSpan - 25 * uiScale) / (220 * uiScale)));
  handCtx.maxStretch = Math.max(handCtx.maxStretch, stretch);

  let snappedFinger = -1;
  for (let f = 0; f < FINGER_TIPS.length; f++) {
    const lm = landmarks[FINGER_TIPS[f]];
    const fy = lm.y * height;
    const prevY = handCtx.prevFingerY[f];
    handCtx.prevFingerY[f] = fy;
    if (prevY !== null && fy - prevY > 15 * uiScale && nowMs - handCtx.lastPluckTime > COOLDOWN_MS) {
      snappedFinger = f;
      break;
    }
  }

  const crossedMiddle =
    middleString.group.visible &&
    handCtx.prevTipX !== null &&
    segmentsCross(
      handCtx.prevTipX,
      handCtx.prevTipY,
      ix,
      iy,
      middleCoords.x1,
      middleCoords.y1,
      middleCoords.x2,
      middleCoords.y2
    );

  handCtx.prevTipX = ix;
  handCtx.prevTipY = iy;

  if (spanPx > 35 * uiScale) {
    handCtx.vibeEnergy = Math.max(handCtx.vibeEnergy, 1.5 + stretch * 2.5);
    if (Math.random() < 0.25) {
      spawnSparks(tx, ty, ix, iy, 1);
    }
  }

  const flicked = spanVel < -11 * uiScale && handCtx.maxStretch > 0.16;
  if ((flicked || crossedMiddle || snappedFinger >= 0) && nowMs - handCtx.lastPluckTime > COOLDOWN_MS) {
    const fIdx = snappedFinger >= 0 ? snappedFinger : 1;
    const pitchStretch = crossedMiddle
      ? Math.min(1, Math.max(0.15, landmarks[8].y))
      : handCtx.maxStretch;
    pluckString(pitchStretch, fIdx);
    handCtx.lastPluckTime = nowMs;
    handCtx.vibeEnergy = 12;
    middleCoords.vibeEnergy = 12;
    const col = STRING_COLORS[colorCounter++ % STRING_COLORS.length];
    addPlacedString(tx, ty, ix, iy, nowMs, col);
    spawnSparks(tx, ty, ix, iy, 14);
    handCtx.maxStretch = 0.2;
  }

  handCtx.vibeEnergy *= 0.92;
  return { tx, ty, ix, iy, spanPx, stretch };
}

function updateHandSkeleton(handCtx, landmarks) {
  const jAttr = handCtx.jointGeo.getAttribute("position");
  for (let i = 0; i < 21; i++) {
    jAttr.array[i * 3] = landmarks[i].x * width;
    jAttr.array[i * 3 + 1] = landmarks[i].y * height;
    jAttr.array[i * 3 + 2] = 0;
  }
  jAttr.needsUpdate = true;

  const sAttr = handCtx.skelGeo.getAttribute("position");
  for (let c = 0; c < HAND_CONNECTIONS.length; c++) {
    const [a, b] = HAND_CONNECTIONS[c];
    const base = c * 6;
    sAttr.array[base] = landmarks[a].x * width;
    sAttr.array[base + 1] = landmarks[a].y * height;
    sAttr.array[base + 2] = 0;
    sAttr.array[base + 3] = landmarks[b].x * width;
    sAttr.array[base + 4] = landmarks[b].y * height;
    sAttr.array[base + 5] = 0;
  }
  sAttr.needsUpdate = true;

  handCtx.skelLines.visible = true;
  handCtx.jointPoints.visible = true;

  for (let f = 0; f < FINGER_TIPS.length; f++) {
    const tip = landmarks[FINGER_TIPS[f]];
    const ring = handCtx.fingerRings[f];
    ring.position.set(tip.x * width, tip.y * height, 0);
    ring.visible = true;
  }
}

calibrateBtn.addEventListener("click", () => {
  initAudio();
  statusEl.textContent = "Audio active — move up/down for filter sweep, snap/flick or strum to play!";
});

// --- 4. Camera Enumeration + MediaPipe Loop ---
async function refreshVideoDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDevices = devices.filter((d) => d.kind === "videoinput");
  return videoDevices;
}

async function openCameraByIndex(idx, preferFacingFallback = null) {
  if (currentStream) {
    for (const track of currentStream.getTracks()) {
      track.stop();
    }
    currentStream = null;
  }

  await refreshVideoDevices();
  let constraints;

  if (videoDevices.length > 0) {
    cameraDeviceIndex = ((idx % videoDevices.length) + videoDevices.length) % videoDevices.length;
    const dev = videoDevices[cameraDeviceIndex];
    constraints = {
      video: {
        deviceId: dev.deviceId ? { exact: dev.deviceId } : undefined,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };
  } else {
    constraints = {
      video: preferFacingFallback
        ? { facingMode: { ideal: preferFacingFallback }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    };
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }

  currentStream = stream;
  video.srcObject = stream;
  await video.play();

  await refreshVideoDevices();
  const activeTrack = stream.getVideoTracks()[0];
  const settings = activeTrack?.getSettings?.() || {};
  const label = (activeTrack?.label || videoDevices[cameraDeviceIndex]?.label || `Camera ${cameraDeviceIndex + 1}`).trim();
  const isBack =
    settings.facingMode === "environment" ||
    /back|rear|environment/i.test(label);

  stageEl.classList.toggle("back-cam", isBack);
  if (camBtn) {
    camBtn.textContent = isBack ? "Cam: Back" : `Cam: ${cameraDeviceIndex + 1}/${Math.max(1, videoDevices.length)}`;
    camBtn.classList.toggle("active", isBack);
  }

  return { label, count: videoDevices.length, isBack };
}

if (camBtn) {
  camBtn.addEventListener("click", async () => {
    try {
      const prevCount = videoDevices.length;
      const info = await openCameraByIndex(cameraDeviceIndex + 1, "environment");
      if (info.count <= 1 && prevCount <= 1) {
        statusEl.textContent = `Only 1 camera detected (${info.label}) — no second/back camera available here.`;
      } else {
        statusEl.textContent = `Active camera (${cameraDeviceIndex + 1}/${info.count}): ${info.label}`;
      }
    } catch (err) {
      statusEl.textContent = `Camera switch error: ${err.message}`;
    }
  });
}

async function setup() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Camera API unavailable in this browser context.");
  }

  const camInfo = await openCameraByIndex(0);

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: MAX_HANDS,
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  statusEl.textContent = `Ready on ${camInfo.label} (${camInfo.count || 1} cam) — toggle Lover Boy or hold hands to play!`;

  let lastFrameMs = performance.now();

  function onFrame(nowMs) {
    const dtMs = Math.min(50, Math.max(1, nowMs - lastFrameMs));
    lastFrameMs = nowMs;

    updatePlacedStrings(nowMs);

    const results = handLandmarker.detectForVideo(video, nowMs);
    const detectedHands = results.landmarks || [];
    const handMids = [];
    let bestHoldStretch = 0;
    let anyHeld = false;

    for (let h = 0; h < MAX_HANDS; h++) {
      const handCtx = hands[h];
      const lm = detectedHands[h];

      if (lm) {
        updateHandSkeleton(handCtx, lm);
        const { tx, ty, ix, iy, spanPx, stretch } = updateHandGesture(handCtx, lm, nowMs);

        updateStringGeometry(handCtx.sg, tx, ty, ix, iy, handCtx.vibeEnergy, nowMs, h * 2.1);
        handCtx.sg.group.visible = spanPx > 32 * uiScale;

        if (spanPx > 45 * uiScale) {
          anyHeld = true;
          bestHoldStretch = Math.max(bestHoldStretch, stretch);
        }

        handMids.push({
          mx: (tx + ix) * 0.5,
          my: (ty + iy) * 0.5,
          stretch
        });
      } else {
        handCtx.smoothSpan = null;
        handCtx.prevSpan = null;
        handCtx.prevTipX = null;
        handCtx.prevTipY = null;
        handCtx.prevFingerY = [null, null, null, null, null];
        handCtx.sg.group.visible = false;
        handCtx.skelLines.visible = false;
        handCtx.jointPoints.visible = false;
        for (const ring of handCtx.fingerRings) ring.visible = false;
      }
    }

    updateHoldSound(anyHeld, bestHoldStretch);

    if (handMids.length === 2) {
      const twoSpan = Math.hypot(handMids[1].mx - handMids[0].mx, handMids[1].my - handMids[0].my);
      const twoVel = prevTwoHandSpan === null ? 0 : twoSpan - prevTwoHandSpan;
      prevTwoHandSpan = twoSpan;

      if (middleHeld && twoVel < -22 * uiScale && nowMs - lastMiddleToggleMs > 550) {
        middleHeld = false;
        middlePinned = false;
        lastMiddleToggleMs = nowMs;
        syncPinButtonLabel();
        spawnSparks(middleCoords.x1, middleCoords.y1, middleCoords.x2, middleCoords.y2, 14);
      } else if (!middleHeld && twoSpan > 110 * uiScale && nowMs - lastMiddleToggleMs > 550) {
        middleHeld = true;
        lastMiddleToggleMs = nowMs;
        syncPinButtonLabel();
      }

      if (middleHeld) {
        middleCoords.x1 = handMids[0].mx;
        middleCoords.y1 = handMids[0].my;
        middleCoords.x2 = handMids[1].mx;
        middleCoords.y2 = handMids[1].my;
        middleCoords.stretch = Math.min(1, twoSpan / (360 * uiScale));
      }
    } else {
      prevTwoHandSpan = null;
    }

    middleCoords.vibeEnergy *= 0.92;
    middleString.group.visible = middleHeld || middlePinned;
    if (middleString.group.visible) {
      updateStringGeometry(
        middleString,
        middleCoords.x1,
        middleCoords.y1,
        middleCoords.x2,
        middleCoords.y2,
        2.5 + middleCoords.stretch * 4 + middleCoords.vibeEnergy * 0.5,
        nowMs,
        4.2
      );
    }

    updateSparks(dtMs);
    renderer.render(scene, camera);

    video.requestVideoFrameCallback(onFrame);
  }

  video.requestVideoFrameCallback(onFrame);
}

setup().catch((err) => {
  console.error(err);
  statusEl.textContent = `Error: ${err.message}`;
});


let quoteStabEnabled = false;
let quoteSyllableIdx = 0;

const QUOTE_LINES = [
  "Lover boy",
  "Oh, lover boy",
  "Close your eyes",
  "Stay with me"
];
let lastQuoteSpeakMs = 0;

function speakVocalQuote(line) {
  if (!("speechSynthesis" in window)) return;
  const nowMs = performance.now();
  if (nowMs - lastQuoteSpeakMs < 650) return;
  lastQuoteSpeakMs = nowMs;

  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(line);
  utter.pitch = 1.05;
  utter.rate = 0.96;
  utter.volume = 1.0;

  const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
  const preferred = voices.find((v) => /en/i.test(v.lang)) || voices[0];
  if (preferred) utter.voice = preferred;

  window.speechSynthesis.speak(utter);
}

function playQuoteStab(freq, startTime, stretch = 0.5) {
  if (!quoteStabEnabled || !audioCtx || !masterBus) return;
  const line = QUOTE_LINES[quoteSyllableIdx % QUOTE_LINES.length];
  quoteSyllableIdx++;

  speakVocalQuote(line);

  // Clearer vocal-like melodic accent so it cuts through chords even without TTS voices
  const dur = 0.5;
  const noteFreq = Math.max(130, freq * 2);

  const leadOsc = audioCtx.createOscillator();
  leadOsc.type = "triangle";
  leadOsc.frequency.setValueAtTime(noteFreq * 0.96, startTime);
  leadOsc.frequency.exponentialRampToValueAtTime(noteFreq * (1.03 + stretch * 0.1), startTime + dur * 0.5);
  leadOsc.frequency.exponentialRampToValueAtTime(noteFreq, startTime + dur);

  const env = audioCtx.createGain();
  const peak = 0.22 + 0.1 * Math.min(1, stretch);
  env.gain.setValueAtTime(0.0001, startTime);
  env.gain.linearRampToValueAtTime(peak, startTime + 0.025);
  env.gain.exponentialRampToValueAtTime(0.0008, startTime + dur);

  leadOsc.connect(env);
  env.connect(masterBus);

  leadOsc.start(startTime);
  leadOsc.stop(startTime + dur + 0.02);
}

function toggleQuoteStab() {
  initAudio();
  quoteStabEnabled = !quoteStabEnabled;
  if (quoteBtn) {
    quoteBtn.textContent = quoteStabEnabled ? "Quote: On" : "Quote: Off";
    quoteBtn.classList.toggle("active", quoteStabEnabled);
  }
  if (typeof statusEl !== "undefined" && statusEl) {
    statusEl.textContent = quoteStabEnabled
      ? "Quote formant stabs active on plucks — snap/flick to trigger vocal hooks!"
      : "Quote formant stabs off.";
  }
}

if (quoteBtn) {
  quoteBtn.addEventListener("click", toggleQuoteStab);
}
