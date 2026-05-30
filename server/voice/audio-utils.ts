/**
 * audio-utils.ts — Audio format conversion for Twilio ↔ Deepgram ↔ TTS
 *
 * Twilio Media Streams send/receive: mulaw 8kHz mono (base64 encoded)
 * Deepgram accepts: mulaw natively (no conversion needed for input)
 * Inworld TTS outputs: mulaw 8kHz natively (no conversion needed for Twilio!)
 * Legacy: PCM conversion utils kept for potential future use.
 */

// mulaw encoding/decoding tables
const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

const EXP_TABLE = [0, 132, 396, 924, 1980, 4092, 8316, 16764];

/**
 * Encode a 16-bit linear PCM sample to 8-bit mulaw
 */
function linearToMulaw(sample: number): number {
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;

  let exponent = 7;
  for (let i = 7; i > 0; i--) {
    if (sample >= EXP_TABLE[i]) {
      exponent = i;
      break;
    }
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return mulawByte;
}

/**
 * Decode an 8-bit mulaw sample to 16-bit linear PCM
 */
function mulawToLinear(mulawByte: number): number {
  mulawByte = ~mulawByte & 0xff;
  const sign = mulawByte & 0x80;
  const exponent = (mulawByte >> 4) & 0x07;
  const mantissa = mulawByte & 0x0f;

  let sample = EXP_TABLE[exponent] + (mantissa << (exponent + 3));
  if (sign !== 0) sample = -sample;
  return sample;
}

/**
 * Convert PCM 16-bit LE buffer to mulaw buffer
 * Used for: ElevenLabs PCM output → Twilio mulaw
 */
export function pcmToMulaw(pcmBuffer: Buffer): Buffer {
  const numSamples = pcmBuffer.length / 2;
  const mulawBuffer = Buffer.alloc(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2);
    mulawBuffer[i] = linearToMulaw(sample);
  }

  return mulawBuffer;
}

/**
 * Convert mulaw buffer to PCM 16-bit LE buffer
 * Used for: Twilio mulaw → PCM (if needed)
 */
export function mulawToPcm(mulawBuffer: Buffer): Buffer {
  const pcmBuffer = Buffer.alloc(mulawBuffer.length * 2);

  for (let i = 0; i < mulawBuffer.length; i++) {
    const sample = mulawToLinear(mulawBuffer[i]);
    pcmBuffer.writeInt16LE(sample, i * 2);
  }

  return pcmBuffer;
}

/**
 * Resample PCM audio from one sample rate to another (simple linear interpolation)
 * Used for: ElevenLabs 22050/24000Hz → Twilio 8000Hz
 */
export function resamplePcm(
  input: Buffer,
  fromRate: number,
  toRate: number
): Buffer {
  if (fromRate === toRate) return input;

  const inputSamples = input.length / 2;
  const ratio = fromRate / toRate;
  const outputSamples = Math.floor(inputSamples / ratio);
  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = i * ratio;
    const srcFloor = Math.floor(srcIndex);
    const srcCeil = Math.min(srcFloor + 1, inputSamples - 1);
    const frac = srcIndex - srcFloor;

    const s1 = input.readInt16LE(srcFloor * 2);
    const s2 = input.readInt16LE(srcCeil * 2);
    const sample = Math.round(s1 + (s2 - s1) * frac);

    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }

  return output;
}

/**
 * Convert ElevenLabs PCM output (typically 22050Hz or 24000Hz, 16-bit LE)
 * to Twilio-ready mulaw (8000Hz, 8-bit mulaw, base64)
 */
export function elevenLabsToTwilio(
  pcmBuffer: Buffer,
  inputSampleRate: number = 24000
): string {
  const resampled = resamplePcm(pcmBuffer, inputSampleRate, 8000);
  const mulaw = pcmToMulaw(resampled);
  return mulaw.toString("base64");
}

/**
 * Chunk a buffer into fixed-size pieces for streaming
 */
export function chunkBuffer(buffer: Buffer, chunkSize: number): Buffer[] {
  const chunks: Buffer[] = [];
  for (let i = 0; i < buffer.length; i += chunkSize) {
    chunks.push(buffer.subarray(i, Math.min(i + chunkSize, buffer.length)));
  }
  return chunks;
}
