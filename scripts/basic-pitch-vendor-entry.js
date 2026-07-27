// Build-time entry for the checked-in, browser-native Basic Pitch bundle.
// The application itself remains zero-build and imports the generated file.
//
// Spotify's public evaluateModel implementation leaves intermediate tensors
// alive, which is acceptable for one file but leaks GPU memory in our rolling
// window use case. This small compatible subclass disposes every per-window
// tensor after its arrays have been copied back to JavaScript.

import * as tf from "@tensorflow/tfjs";
import { BasicPitch as SpotifyBasicPitch } from "@spotify/basic-pitch";

const AUDIO_SAMPLE_RATE = 22050;
const FFT_HOP = 256;
const AUDIO_N_SAMPLES = AUDIO_SAMPLE_RATE * 2 - FFT_HOP;
const N_OVERLAPPING_FRAMES = 30;
const N_OVERLAP_OVER_2 = Math.floor(N_OVERLAPPING_FRAMES / 2);
const HOP_SIZE = AUDIO_N_SAMPLES - N_OVERLAPPING_FRAMES * FFT_HOP;
const ANNOTATIONS_FPS = Math.floor(AUDIO_SAMPLE_RATE / FFT_HOP);
const OUTPUTS = ["Identity_1", "Identity_2", "Identity"];

export class BasicPitch extends SpotifyBasicPitch {
  unwrapOutput(result) {
    return tf.tidy(() => {
      const sliced = result.slice(
        [0, N_OVERLAP_OVER_2, 0],
        [-1, result.shape[1] - 2 * N_OVERLAP_OVER_2, -1]
      );
      return sliced.reshape([sliced.shape[0] * sliced.shape[1], sliced.shape[2]]);
    });
  }

  async prepareData(singleChannelAudioData) {
    const framed = tf.tidy(() => {
      const samples = tf.concat1d([
        tf.zeros([Math.floor(N_OVERLAPPING_FRAMES * FFT_HOP / 2)], "float32"),
        tf.tensor(singleChannelAudioData),
      ]);
      return tf.expandDims(tf.signal.frame(samples, AUDIO_N_SAMPLES, HOP_SIZE, true, 0), -1);
    });
    return [framed, singleChannelAudioData.length];
  }

  async evaluateSingleFrame(reshapedInput, batchNumber) {
    const model = await this.model;
    return tf.tidy(() => {
      const batch = tf.slice(reshapedInput, batchNumber, 1);
      const results = model.execute(batch, OUTPUTS);
      return [results[0], results[1], results[2]];
    });
  }

  async evaluateModel(input, onComplete, percentCallback) {
    const samples = input instanceof Float32Array ? input : input.getChannelData(0);
    const [reshapedInput, originalLength] = await this.prepareData(samples);
    const outputFrameCount = Math.floor(originalLength * ANNOTATIONS_FPS / AUDIO_SAMPLE_RATE);
    let calculatedFrames = 0;

    try {
      for (let i = 0; i < reshapedInput.shape[0]; i++) {
        percentCallback(i / reshapedInput.shape[0]);
        const raw = await this.evaluateSingleFrame(reshapedInput, i);
        let unwrapped = raw.map((tensor) => this.unwrapOutput(tensor));
        try {
          const calculatedThisBatch = unwrapped[0].shape[0];
          if (calculatedFrames >= outputFrameCount) continue;
          if (calculatedFrames + calculatedThisBatch > outputFrameCount) {
            const keep = outputFrameCount - calculatedFrames;
            const cropped = unwrapped.map((tensor) => tensor.slice([0, 0], [keep, -1]));
            tf.dispose(unwrapped);
            unwrapped = cropped;
          }
          calculatedFrames += calculatedThisBatch;
          const arrays = await Promise.all(unwrapped.map((tensor) => tensor.array()));
          onComplete(arrays[0], arrays[1], arrays[2]);
        } finally {
          tf.dispose([...raw, ...unwrapped]);
        }
      }
    } finally {
      reshapedInput.dispose();
    }
    percentCallback(1);
  }
}

export {
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";
