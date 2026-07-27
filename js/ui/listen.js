// Listen popover and live audio-to-tab session controller.

import { CHORDS_DB } from "../vendor/globals.js";
import { isTabBlock } from "../core/model.js";
import {
  state,
  beginListeningTransaction,
  applyListeningTransaction,
  finishListeningTransaction,
  cancelListeningTransaction,
} from "../core/store.js";
import {
  enumerateNoteFingerings,
  findFretAnchorBeforeCursor,
  midiToName,
  rankChordShapes,
} from "../core/fretboard.js";
import { materializeListeningPhrase } from "../core/listening-session.js";
import { AudioCapture } from "../audio/capture.js";
import { LeadEngine } from "../audio/lead-engine.js";
import { ChordEngine } from "../audio/chord-engine.js";
import { $, focusKeyboard } from "./dom.js";
import { confirmDialog } from "./dialogs.js";
import { toast } from "./toast.js";

let active = false;
let paused = false;
let mode = "lead";
let token = null;
let startContext = null;
let events = [];
let selectedEvent = -1;
let pendingEvent = null;
let capture = null;
let leadEngine = null;
let chordEngine = null;
let statusText = "Ready";
let level = 0;
let lastChordSignature = "";
let lastChordAt = 0;
let captureAttempt = 0;

const popup = () => $("listen-popover");

const lockEditorInteraction = (locked) => {
  const toolbar = document.querySelector(".toolbar");
  const editor = $("editor");
  if (toolbar) toolbar.inert = locked;
  if (editor) editor.inert = locked;
  document.body.classList.toggle("listening-active", locked);
};

const selectedCandidate = (event) => event?.candidates[event.selectedCandidate] || null;

const currentAnchor = (untilIndex = events.length) => {
  let anchorFret = startContext?.anchorFret ?? null;
  let previousString = null;
  for (let i = 0; i < Math.min(untilIndex, events.length); i++) {
    const candidate = selectedCandidate(events[i]);
    if (!candidate) continue;
    anchorFret = candidate.positionFret;
    if (Number.isInteger(candidate.stringIdx)) previousString = candidate.stringIdx;
  }
  return { anchorFret, previousString };
};

const makeCandidates = (kind, pitches, anchor, preferredString = null) => {
  if (kind === "note") {
    return enumerateNoteFingerings(pitches[0].midi, {
      anchorFret: anchor.anchorFret,
      previousString: anchor.previousString,
      preferredString,
    });
  }
  return rankChordShapes(CHORDS_DB, pitches, {
    anchorFret: anchor.anchorFret,
    limit: 24,
  });
};

const buildEvent = (kind, pitches, anchor = currentAnchor()) => {
  const candidates = makeCandidates(
    kind,
    pitches,
    anchor,
    events.length === 0 ? startContext.stringIdx : null
  );
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    pitches,
    candidates,
    selectedCandidate: 0,
    manuallyPinned: false,
    confidence: pitches.reduce((sum, pitch) => sum + (pitch.confidence ?? 0), 0) /
      Math.max(1, pitches.length),
  };
};

const rerankAfter = (changedIndex) => {
  for (let i = changedIndex + 1; i < events.length; i++) {
    if (events[i].manuallyPinned) continue;
    const anchor = currentAnchor(i);
    const candidates = makeCandidates(events[i].kind, events[i].pitches, anchor);
    events[i] = { ...events[i], candidates, selectedCandidate: 0 };
  }
};

const applyEvents = () => {
  if (!token || !startContext) return;
  const document = materializeListeningPhrase({
    baselineBlocks: token.baseline.blocks,
    startBlock: startContext.block,
    startCol: startContext.col,
    startString: startContext.stringIdx,
    lineLength: token.baseline.lineLength,
    editMode: token.baseline.editMode,
    events,
  });
  applyListeningTransaction(token, document);
  render();
};

const addEvent = (event) => {
  if (!event.candidates.length) {
    statusText = event.kind === "chord"
      ? "No common chord shape matched"
      : "Detected pitch is outside the 24-fret range";
    pendingEvent = event;
    render();
    return;
  }
  events.push(event);
  selectedEvent = events.length - 1;
  pendingEvent = null;
  applyEvents();
};

const handleLeadPitch = (pitch) => {
  if (!active || paused || mode !== "lead") return;
  statusText = `Detected ${midiToName(pitch.midi)}`;
  addEvent(buildEvent("note", [pitch]));
};

const handleChord = (pitches) => {
  if (!active || paused || mode !== "chord") return;
  const signature = pitches.map((pitch) => pitch.midi).sort((a, b) => a - b).join(",");
  const now = performance.now();
  if (signature === lastChordSignature && now - lastChordAt < 1200) return;
  lastChordSignature = signature;
  lastChordAt = now;

  const event = buildEvent("chord", pitches);
  const best = event.candidates[0];
  statusText = best ? `Detected ${best.label}` : "Chord uncertain";
  if (!best || best.pitchCoverage < 0.66 || event.confidence < 0.16) {
    pendingEvent = event;
    render();
    return;
  }
  addEvent(event);
};

const setStatus = (message) => {
  statusText = message;
  render();
};

const ensureEngines = () => {
  if (!leadEngine) {
    leadEngine = new LeadEngine({
      onPitch: handleLeadPitch,
      onLevel: (value) => {
        level = value;
        renderMeter();
      },
    });
  }
  if (!chordEngine) {
    chordEngine = new ChordEngine({
      onChord: handleChord,
      onLevel: (value) => {
        level = value;
        renderMeter();
      },
      onStatus: setStatus,
    });
  }
  const sensitivity = $("listen-sensitivity")?.value ?? 0.5;
  leadEngine.setSensitivity(sensitivity);
  chordEngine.setSensitivity(sensitivity);
};

const onSamples = (samples, sampleRate) => {
  if (!active || paused) return;
  if (mode === "lead") leadEngine.push(samples, sampleRate);
  else chordEngine.push(samples, sampleRate);
};

const populateDevices = async () => {
  const select = $("listen-device");
  if (!select) return;
  const current = capture?.stream?.getAudioTracks()[0]?.getSettings()?.deviceId || select.value;
  const devices = await AudioCapture.devices();
  select.innerHTML = "";
  devices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Audio input ${index + 1}`;
    select.appendChild(option);
  });
  if (current && [...select.options].some((option) => option.value === current)) select.value = current;
};

const startCapture = async (deviceId = "") => {
  const attempt = ++captureAttempt;
  const nextCapture = new AudioCapture({
    onSamples,
    onDeviceEnded: () => {
      if (!active || capture !== nextCapture) return;
      paused = true;
      level = 0;
      setStatus("Audio input disconnected");
    },
  });
  capture = nextCapture;
  try {
    statusText = "Requesting microphone access…";
    render();
    await nextCapture.start(deviceId);
    if (!active || attempt !== captureAttempt || capture !== nextCapture) {
      await nextCapture.stop();
      return;
    }
    await populateDevices();
    statusText = mode === "lead" ? "Listening for notes" : "Preparing chord model…";
    if (mode === "chord") await chordEngine.load();
    if (!active || attempt !== captureAttempt || capture !== nextCapture) return;
    statusText = mode === "lead" ? "Listening for notes" : "Listening for chords";
    render();
  } catch (error) {
    if (!active || attempt !== captureAttempt || error?.name === "AbortError") return;
    paused = true;
    const message = error?.name === "NotAllowedError"
      ? "Microphone access was denied"
      : error?.name === "NotFoundError"
        ? "No audio input was found"
        : (error.message || "Could not start audio input");
    setStatus(message);
    toast(message, "danger");
  }
};

const positionPopup = () => {
  const el = popup();
  const cursor = document.querySelector(".ch.cursor");
  if (!el || !cursor) return;
  const rect = cursor.getBoundingClientRect();
  el.style.left = `${Math.max(10, Math.min(window.innerWidth - 350, rect.left))}px`;
  el.style.top = `${Math.max(10, Math.min(window.innerHeight - 360, rect.bottom + 10))}px`;
};

const renderMeter = () => {
  const meter = $("listen-meter-fill");
  if (meter) meter.style.width = `${Math.round(level * 100)}%`;
};

const render = () => {
  const el = popup();
  if (!el) return;
  el.classList.toggle("visible", active);
  $("listen-status").textContent = statusText;
  $("listen-event-count").textContent = `${events.length} ${events.length === 1 ? "event" : "events"}`;
  $("listen-pause").textContent = paused ? "Resume" : "Pause";
  $("listen-mode").value = mode;

  const event = pendingEvent || events[selectedEvent] || null;
  const candidate = selectedCandidate(event);
  $("listen-detection").textContent = event
    ? event.kind === "note"
      ? midiToName(event.pitches[0].midi)
      : (candidate?.label || event.pitches.map((pitch) => midiToName(pitch.midi)).join(" · "))
    : "Play a note";
  $("listen-confidence").textContent = event
    ? `${Math.round(event.confidence * 100)}% confidence`
    : "";
  $("listen-candidate").textContent = candidate
    ? `${candidate.label} · ${event.selectedCandidate + 1}/${event.candidates.length}`
    : "No fingering yet";
  $("listen-pending").classList.toggle("is-hidden", !pendingEvent?.candidates.length);

  const preview = $("listen-tab-preview");
  if (candidate) {
    const labels = ["e", "B", "G", "D", "A", "E"];
    preview.textContent = candidate.rows.map((value, index) =>
      `${labels[index]}|${value || "-"}`
    ).join("\n");
  } else {
    preview.textContent = "e|-\nB|-\nG|-\nD|-\nA|-\nE|-";
  }
  renderMeter();
};

export const startListening = async () => {
  if (active) return;
  if (!isTabBlock(state.blocks[state.cur.block])) {
    toast("Place the cursor in a tab block before listening.", "warning");
    return;
  }
  if (!AudioCapture.supported()) {
    toast("This browser does not support live audio capture.", "danger");
    return;
  }

  ensureEngines();
  token = beginListeningTransaction();
  startContext = {
    ...state.cur,
    anchorFret: findFretAnchorBeforeCursor(state.blocks, state.cur.block, state.cur.col),
  };
  events = [];
  selectedEvent = -1;
  pendingEvent = null;
  lastChordSignature = "";
  lastChordAt = 0;
  active = true;
  lockEditorInteraction(true);
  paused = false;
  statusText = "Starting audio input…";
  level = 0;
  leadEngine.reset();
  chordEngine.reset();
  render();
  positionPopup();
  await startCapture($("listen-device")?.value || "");
};

export const pauseListening = () => {
  if (!active) return;
  paused = !paused;
  capture?.setPaused(paused);
  if (paused) level = 0;
  if (!paused) {
    leadEngine.reset();
    statusText = mode === "lead" ? "Listening for notes" : "Listening for chords";
  } else {
    statusText = "Paused";
  }
  render();
  focusKeyboard();
};

export const finishListening = async () => {
  if (!active) return;
  if (events.length) finishListeningTransaction(token);
  else cancelListeningTransaction(token);
  active = false;
  lockEditorInteraction(false);
  token = null;
  popup()?.classList.remove("visible");
  captureAttempt++;
  const currentCapture = capture;
  capture = null;
  await currentCapture?.stop();
  focusKeyboard();
};

export const cancelListening = async (ask = true) => {
  if (!active) return;
  if (ask && events.length) {
    const confirmed = await confirmDialog({
      message: "Discard all notes added during this listening session?",
      confirmLabel: "Discard",
    });
    if (!confirmed) return;
  }
  cancelListeningTransaction(token);
  active = false;
  lockEditorInteraction(false);
  token = null;
  popup()?.classList.remove("visible");
  captureAttempt++;
  const currentCapture = capture;
  capture = null;
  await currentCapture?.stop();
  focusKeyboard();
};

const cycleCandidate = (direction) => {
  if (pendingEvent?.candidates.length) {
    pendingEvent.selectedCandidate =
      (pendingEvent.selectedCandidate + direction + pendingEvent.candidates.length) %
      pendingEvent.candidates.length;
    render();
    return;
  }
  const event = events[selectedEvent];
  if (!event?.candidates.length) return;
  event.selectedCandidate =
    (event.selectedCandidate + direction + event.candidates.length) % event.candidates.length;
  event.manuallyPinned = true;
  rerankAfter(selectedEvent);
  applyEvents();
};

const navigateEvent = (direction) => {
  if (!events.length) return;
  selectedEvent = Math.max(0, Math.min(events.length - 1, selectedEvent + direction));
  pendingEvent = null;
  render();
};

const removeSelectedEvent = () => {
  if (selectedEvent < 0 || selectedEvent >= events.length) return;
  events.splice(selectedEvent, 1);
  selectedEvent = Math.min(selectedEvent, events.length - 1);
  rerankAfter(Math.max(-1, selectedEvent - 1));
  applyEvents();
};

export const isListeningActive = () => active;

export const handleListeningKey = (event) => {
  if (!active) return false;
  if (event.target?.closest?.("#listen-popover") &&
      (event.target.tagName === "SELECT" || event.target.tagName === "INPUT")) {
    return false;
  }
  switch (event.key) {
    case "ArrowLeft": navigateEvent(-1); break;
    case "ArrowRight": navigateEvent(1); break;
    case "ArrowUp": cycleCandidate(-1); break;
    case "ArrowDown": cycleCandidate(1); break;
    case " ":
    case "Spacebar": pauseListening(); break;
    case "Backspace":
    case "Delete": removeSelectedEvent(); break;
    case "Enter":
      if (pendingEvent?.candidates.length) addEvent(pendingEvent);
      break;
    case "Escape": void cancelListening(true); break;
    default: return false;
  }
  event.preventDefault();
  event.stopPropagation();
  return true;
};

export const initListen = () => {
  $("btn-listen").addEventListener("click", startListening);
  $("listen-pause").addEventListener("click", pauseListening);
  $("listen-done").addEventListener("click", finishListening);
  $("listen-cancel").addEventListener("click", () => cancelListening(true));
  $("listen-prev").addEventListener("click", () => navigateEvent(-1));
  $("listen-next").addEventListener("click", () => navigateEvent(1));
  $("listen-candidate-prev").addEventListener("click", () => cycleCandidate(-1));
  $("listen-candidate-next").addEventListener("click", () => cycleCandidate(1));
  $("listen-add-pending").addEventListener("click", () => {
    if (pendingEvent?.candidates.length) addEvent(pendingEvent);
  });
  $("listen-mode").addEventListener("change", async (event) => {
    mode = event.target.value === "chord" ? "chord" : "lead";
    leadEngine?.reset();
    chordEngine?.reset();
    if (active && mode === "chord") {
      try {
        await chordEngine.load();
      } catch (error) {
        if (!active) return;
        paused = true;
        capture?.setPaused(true);
        const message = `Chord model failed: ${error.message || error}`;
        setStatus(message);
        toast(message, "danger");
        return;
      }
    }
    statusText = mode === "lead" ? "Listening for notes" : "Listening for chords";
    render();
  });
  $("listen-sensitivity").addEventListener("input", (event) => {
    leadEngine?.setSensitivity(event.target.value);
    chordEngine?.setSensitivity(event.target.value);
  });
  $("listen-device").addEventListener("change", async (event) => {
    if (!active) return;
    captureAttempt++;
    const currentCapture = capture;
    capture = null;
    await currentCapture?.stop();
    if (!active) return;
    paused = false;
    leadEngine.reset();
    chordEngine.reset();
    await startCapture(event.target.value);
  });
  window.addEventListener("pagehide", () => {
    if (active) void cancelListening(false);
  });
  render();
};
