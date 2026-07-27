export class AudioCapture {
  constructor({ onSamples, onDeviceEnded } = {}) {
    this.onSamples = onSamples || (() => {});
    this.onDeviceEnded = onDeviceEnded || (() => {});
    this.context = null;
    this.stream = null;
    this.source = null;
    this.worklet = null;
    this.runId = 0;
  }

  static supported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.AudioContext && window.AudioWorkletNode);
  }

  static async devices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audioinput");
  }

  async start(deviceId = "") {
    if (!AudioCapture.supported()) throw new Error("Live audio capture is not supported by this browser.");
    if (this.context || this.stream) await this.stop();
    const runId = ++this.runId;
    const audio = {
      channelCount: { ideal: 1 },
      echoCancellation: { ideal: false },
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: false },
    };
    if (deviceId) audio.deviceId = { exact: deviceId };

    // Construct AudioContext synchronously in the Listen button's user gesture;
    // iPad Safari may otherwise refuse to resume it after the permission await.
    this.context = new AudioContext({ latencyHint: "interactive" });
    const moduleReady = this.context.audioWorklet.addModule("./js/audio/capture-worklet.js");
    let acquiredStream = null;
    const mediaReady = navigator.mediaDevices.getUserMedia({ audio, video: false }).then((stream) => {
      acquiredStream = stream;
      if (runId !== this.runId) {
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException("Audio capture was stopped before it started.", "AbortError");
      }
      return stream;
    });
    try {
      const [stream] = await Promise.all([mediaReady, moduleReady]);
      if (runId !== this.runId) {
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException("Audio capture was stopped before it started.", "AbortError");
      }
      this.stream = stream;
    } catch (error) {
      acquiredStream?.getTracks().forEach((track) => track.stop());
      await this.stop();
      throw error;
    }
    const track = this.stream.getAudioTracks()[0];
    track.addEventListener("ended", () => this.onDeviceEnded());

    this.source = this.context.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(this.context, "tab-capture-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    this.worklet.port.onmessage = (event) => this.onSamples(event.data, this.context.sampleRate);
    this.source.connect(this.worklet);
    this.worklet.connect(this.context.destination);
    if (this.context.state === "suspended") await this.context.resume();
    return { stream: this.stream, sampleRate: this.context.sampleRate };
  }

  setPaused(paused) {
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !paused;
    });
  }

  async stop() {
    this.runId++;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect();
    this.worklet?.disconnect();
    this.worklet?.port?.close();
    if (this.context && this.context.state !== "closed") {
      try {
        await this.context.close();
      } catch {
        // Already closing.
      }
    }
    this.context = null;
    this.stream = null;
    this.source = null;
    this.worklet = null;
  }
}
