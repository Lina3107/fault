"use strict";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const STEPS = 11;
const waveTypes = ["triangle", "sine", "square", "sawtooth"];
const drumNames = ["KICK", "SNARE", "HAT", "CLAP"];
const effectNames = ["DELAY", "REVERB", "DISTORTION", "CHORUS"];
const defaultHits = [
  [0, 3, 7, 10],
  [0, 4, 7, 10],
  [1, 4, 8, 10],
  [0, 6, 9],
];
const melody = [
  ["G4", null, null, "Eb4", null, "C4", null, "Bb3", null, "C4", null],
  ["Eb4", null, null, "G4", null, null, "F4", null, "Eb4", null, null],
  ["G4", null, "Bb4", null, null, "G4", null, "Eb4", null, "F4", null],
  ["F4", null, null, "D4", null, "C4", null, null, "D4", null, null],
];
const bassRoots = ["C2", "Ab1", "Eb2", "Bb1"];
const waveTrim = { triangle: 0, sine: 0, square: -4.5, sawtooth: -3 };
const state = {
  voices: [
    { wave: "triangle", volume: 38, pan: -0.3 },
    { wave: "sine", volume: 48, pan: 0.12 },
  ],
  drums: defaultHits.map((hits) =>
    Array.from({ length: STEPS }, (_, n) => hits.includes(n)),
  ),
  drumMuted: [false, false, false, false],
  effects: [18, 24, 14, 20].map((amount) => ({ amount, enabled: false })),
  ticks: 0,
  playing: false,
};
let audio,
  readyPromise,
  busy = false,
  commandId = 0,
  visualGeneration = 0,
  pauseTick = 0;
const gainDB = (value) =>
  value <= 0 ? -Infinity : 20 * Math.log10(value / 100);
function status(message, error = false) {
  $("#status").textContent = message;
  $("#status").classList.toggle("error", error);
}
function renderControls() {
  $$(".voice").forEach((panel, i) => {
    const voice = state.voices[i];
    panel
      .querySelectorAll(".wave")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.wave === voice.wave),
        ),
      );
    const volume = panel.querySelector(".volume");
    volume.value = voice.volume;
    volume.style.setProperty("--fill", `${voice.volume}%`);
  });
  $$(".drum-row").forEach((row, i) => {
    row
      .querySelectorAll(".step")
      .forEach((button, n) =>
        button.setAttribute("aria-pressed", String(state.drums[i][n])),
      );
    const name = row.querySelector(".drum-name");
    name.setAttribute("aria-pressed", String(state.drumMuted[i]));
    name.setAttribute(
      "aria-label",
      `${state.drumMuted[i] ? "Включить" : "Выключить"} партию ${drumNames[i]}`,
    );
    name.title = `${drumNames[i]}: ${state.drumMuted[i] ? "выключен" : "включён"}. Нажмите, чтобы ${state.drumMuted[i] ? "включить" : "выключить"} партию.`;
  });
  $$(".effect-toggle").forEach((button, i) =>
    button.setAttribute("aria-pressed", String(state.effects[i].enabled)),
  );
}
function setVoiceVolume(i, time) {
  if (!audio) return;
  const voice = state.voices[i];
  const level =
    voice.volume <= 0
      ? -Infinity
      : gainDB(voice.volume) + waveTrim[audio.appliedWaves[i]];
  audio.voiceChannels[i].volume.rampTo(level, 0.055, time);
}
function selectWave(i, wave) {
  if (!waveTypes.includes(wave) || state.voices[i].wave === wave) return;
  state.voices[i].wave = wave;
  renderControls();
  status(
    `Синтезатор ${i + 1}: ${wave}. Новая волна прозвучит со следующей ноты.`,
  );
}
function prepareVoice(i, time) {
  const wave = state.voices[i].wave;
  if (audio.appliedWaves[i] === wave) return;
  audio.synths[i].set({ oscillator: { type: wave } });
  audio.appliedWaves[i] = wave;
  setVoiceVolume(i, time);
}
function applyEffects(time) {
  if (!audio) return;
  state.effects.forEach((fx, i) =>
    audio.effects[i].wet.rampTo(fx.enabled ? fx.amount / 100 : 0, 0.08, time),
  );
}
async function initAudio() {
  if (!window.Tone) throw new Error("Не найден локальный файл vendor/Tone.js.");
  await Tone.start();
  if (!readyPromise)
    readyPromise = createAudio().catch((error) => {
      readyPromise = undefined;
      throw error;
    });
  await readyPromise;
}
async function createAudio() {
  const transport = Tone.getTransport();
  transport.bpm.value = 108;
  transport.timeSignature = [11, 8];
  const effects = [
    new Tone.PingPongDelay({ delayTime: "8n.", feedback: 0.27, wet: 0 }),
    new Tone.Reverb({ decay: 3.2, preDelay: 0.025, wet: 0 }),
    new Tone.Distortion({ distortion: 0.25, oversample: "2x", wet: 0 }),
    new Tone.Chorus({
      frequency: 0.8,
      delayTime: 3.5,
      depth: 0.4,
      wet: 0,
    }).start(),
  ];
  const master = new Tone.Gain(0.68);
  const limiter = new Tone.Limiter(-1).toDestination();
  effects[0].chain(effects[1], effects[2], effects[3], master, limiter);
  const split = new Tone.Split();
  const meters = [
    new Tone.Meter({ normalRange: true, smoothing: 0.78 }),
    new Tone.Meter({ normalRange: true, smoothing: 0.78 }),
  ];
  limiter.connect(split);
  split.connect(meters[0], 0, 0);
  split.connect(meters[1], 1, 0);
  const voiceChannels = state.voices.map((voice) =>
    new Tone.Channel({
      volume: gainDB(voice.volume) + waveTrim[voice.wave],
      pan: voice.pan,
    }).connect(effects[0]),
  );
  const initialWaves = state.voices.map((voice) => voice.wave);
  const synths = [
    new Tone.Synth({
      oscillator: { type: initialWaves[0] },
      envelope: { attack: 0.045, decay: 0.3, sustain: 0.3, release: 1.25 },
      portamento: 0.025,
    }),
    new Tone.Synth({
      oscillator: { type: initialWaves[1] },
      envelope: { attack: 0.012, decay: 0.18, sustain: 0.15, release: 0.2 },
    }),
  ];
  synths.forEach((synth, i) => synth.connect(voiceChannels[i]));
  const drumChannels = [0, -0.14, 0.48, -0.38].map((pan, i) =>
    new Tone.Channel({ pan, volume: [-8, -20, -28, -24][i] }).connect(
      effects[0],
    ),
  );
  const drums = [
    new Tone.MembraneSynth({
      pitchDecay: 0.03,
      octaves: 5,
      envelope: { attack: 0.001, decay: 0.24, sustain: 0, release: 0.08 },
    }),
    new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.03 },
    }),
    new Tone.MetalSynth({
      harmonicity: 5.1,
      modulationIndex: 24,
      resonance: 4200,
      octaves: 1.2,
      envelope: { attack: 0.001, decay: 0.035, release: 0.012 },
    }),
    new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.008, decay: 0.16, sustain: 0, release: 0.05 },
    }),
  ];
  drums.forEach((drum, i) => drum.connect(drumChannels[i]));
  await effects[1].ready;
  audio = {
    transport,
    effects,
    master,
    limiter,
    split,
    meters,
    voiceChannels,
    synths,
    drumChannels,
    drums,
    appliedWaves: initialWaves,
  };
  audio.clock = new Tone.Loop(scheduleStep, "8n").start(0);
  state.voices.forEach((_, i) => setVoiceVolume(i, Tone.now()));
  applyEffects(Tone.now());
  updateMeters();
}
function scheduleStep(time) {
  const tick = state.ticks,
    step = tick % STEPS,
    cycle = Math.floor(tick / STEPS) % 4;
  const note = melody[cycle][step];
  if (note && state.voices[0].volume > 0) {
    prepareVoice(0, time);
    audio.synths[0].triggerAttackRelease(
      note,
      "8n.",
      time,
      step === 0 ? 0.72 : 0.6,
    );
  }
  if ([0, 3, 7, 10].includes(step) && state.voices[1].volume > 0) {
    prepareVoice(1, time);
    audio.synths[1].triggerAttackRelease(
      bassRoots[cycle],
      "16n",
      time,
      step === 0 ? 0.88 : 0.7,
    );
  }
  state.drums.forEach((pattern, i) => {
    if (!state.drumMuted[i] && pattern[step])
      triggerDrum(i, time, step === 0 || step === 7 ? 1 : 0.78);
  });
  const generation = visualGeneration;
  Tone.getDraw().schedule(() => {
    if (generation !== visualGeneration || !state.playing) return;
    pauseTick = tick + 1;
    showStep(step);
  }, time);
  state.ticks++;
}
function triggerDrum(i, time, velocity = 1) {
  if (i === 0)
    audio.drums[i].triggerAttackRelease("C1", "16n", time, 0.86 * velocity);
  else if (i === 2)
    audio.drums[i].triggerAttackRelease("C5", "32n", time, 0.38 * velocity);
  else audio.drums[i].triggerAttackRelease("32n", time, 0.74 * velocity);
}
function showStep(step) {
  $$(".drum-row").forEach((row) =>
    row
      .querySelectorAll(".step")
      .forEach((button, n) => button.classList.toggle("current", n === step)),
  );
}
function updateMeters() {
  if (!audio) return;
  audio.meters.forEach((meter, i) => {
    const raw = Number(meter.getValue());
    const decibels = Math.min(
      0,
      Math.max(
        -60,
        20 * Math.log10(Math.max(0.000001, Number.isFinite(raw) ? raw : 0)),
      ),
    );
    const fill = $(i === 0 ? "#meter-l" : "#meter-r");
    fill.style.width = `${((decibels + 60) / 60) * 100}%`;
    fill.parentElement.setAttribute("aria-valuenow", decibels.toFixed(1));
  });
  requestAnimationFrame(updateMeters);
}
function syncPlay() {
  $("#play").setAttribute("aria-pressed", String(state.playing));
  $("#play").setAttribute(
    "aria-label",
    state.playing ? "Пауза" : "Начать воспроизведение",
  );
  $("#play-icon").classList.toggle("paused-icon", state.playing);
}
async function togglePlay() {
  if (busy) return;
  const id = ++commandId;
  busy = true;
  $("#play").disabled = true;
  try {
    await initAudio();
    if (id !== commandId) return;
    if (state.playing) {
      state.playing = false;
      visualGeneration++;
      audio.transport.pause();
      audio.synths.forEach((synth) => synth.triggerRelease());
      state.ticks = pauseTick;
      status("Пауза. Настройки сохранены.");
    } else {
      state.playing = true;
      audio.master.gain.rampTo(0.68, 0.03);
      audio.transport.position = Tone.Time("8n").toSeconds() * state.ticks;
      audio.transport.start("+0.05");
      status("Воспроизведение. Развитие композиции — под вашим управлением.");
    }
    syncPlay();
  } catch (error) {
    state.playing = false;
    syncPlay();
    console.error(error);
    status(`Не удалось включить звук: ${error.message}`, true);
  } finally {
    busy = false;
    $("#play").disabled = false;
  }
}
function stopPlayback() {
  commandId++;
  visualGeneration++;
  state.playing = false;
  state.ticks = 0;
  pauseTick = 0;
  if (audio) {
    audio.transport.stop();
    audio.transport.position = 0;
    audio.synths.forEach((synth) => synth.triggerRelease());
  }
  showStep(-1);
  syncPlay();
  status(
    "Остановлено. Настройки сохранены. Эффекты могут естественно затухать.",
  );
}
function buildInterface() {
  $$(".voice").forEach((panel, i) => {
    panel.querySelector(".waves").innerHTML = waveTypes
      .map(
        (type) =>
          `<button class="wave" data-wave="${type}" aria-label="${type}" title="${type}: звучит со следующей ноты" aria-pressed="false">${type === "sawtooth" ? "SAW" : type.toUpperCase()}</button>`,
      )
      .join("");
    panel
      .querySelectorAll(".wave")
      .forEach((button) =>
        button.addEventListener("click", () =>
          selectWave(i, button.dataset.wave),
        ),
      );
    panel.querySelector(".volume").addEventListener("input", (event) => {
      state.voices[i].volume = Number(event.target.value);
      renderControls();
      setVoiceVolume(i, Tone.now());
    });
  });
  $("#drum-grid").innerHTML = drumNames
    .map(
      (name) =>
        `<div class="drum-row"><button class="drum-name" aria-pressed="false">${name}</button>${Array.from({ length: STEPS }, (_, n) => `<button class="step" aria-pressed="false" aria-label="${name}, шаг ${n + 1}"></button>`).join("")}</div>`,
    )
    .join("");
  $$(".drum-row").forEach((row, i) => {
    row.querySelectorAll(".step").forEach((button, n) =>
      button.addEventListener("click", () => {
        state.drums[i][n] = !state.drums[i][n];
        renderControls();
      }),
    );
    row.querySelector(".drum-name").addEventListener("click", () => {
      state.drumMuted[i] = !state.drumMuted[i];
      renderControls();
      status(
        `${drumNames[i]}: партия ${state.drumMuted[i] ? "выключена" : "включена"}.`,
      );
    });
  });
  $("#effects").innerHTML = effectNames
    .map(
      (name) =>
        `<button class="effect-toggle" aria-label="Включить или выключить ${name}" aria-pressed="false"><span>${name}</span><i aria-hidden="true"></i></button>`,
    )
    .join("");
  $$(".effect-toggle").forEach((button, i) =>
    button.addEventListener("click", () => {
      state.effects[i].enabled = !state.effects[i].enabled;
      renderControls();
      applyEffects(Tone.now());
    }),
  );
  $("#play").addEventListener("click", togglePlay);
  $("#stop").addEventListener("click", stopPlayback);
  document.addEventListener("keydown", (event) => {
    if (
      event.code !== "Space" ||
      event.repeat ||
      /INPUT|BUTTON|A|TEXTAREA|SELECT/.test(document.activeElement.tagName)
    )
      return;
    event.preventDefault();
    togglePlay();
  });
}
function fitInstrument() {
  document.documentElement.style.setProperty(
    "--instrument-scale",
    Math.min(innerHeight / 1194, innerWidth / 1920),
  );
}
buildInterface();
renderControls();
syncPlay();
fitInstrument();
window.addEventListener("resize", fitInstrument);
