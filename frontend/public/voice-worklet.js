// AudioWorklet para el modo voz: captura el micrófono, lo remuestrea a 16 kHz,
// lo convierte a PCM 16-bit y lo ACUMULA en bloques de ~100 ms antes de enviar.
//
// Por qué el buffer: process() se invoca cada 128 muestras (~375 veces/seg a
// 48 kHz). Enviar un mensaje por cada invocación satura el WebSocket con miles
// de paquetes minúsculos por segundo. Acumulamos hasta juntar FRAME_MS de audio
// y recién ahí emitimos un solo bloque — ~10 mensajes/seg en vez de ~375.

const TARGET_RATE = 16000;
const FRAME_MS = 100; // duración de cada bloque enviado
const FRAME_SAMPLES = (TARGET_RATE * FRAME_MS) / 1000; // 1600 muestras

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // sampleRate es global dentro del worklet (rate del AudioContext).
    this.ratio = sampleRate / TARGET_RATE;
    this._frac = 0; // posición fraccional acumulada entre bloques

    // Buffer de salida a 16 kHz; emitimos cuando se llena FRAME_SAMPLES.
    this._buf = new Int16Array(FRAME_SAMPLES);
    this._bufLen = 0;
  }

  _push(sample) {
    sample = Math.max(-1, Math.min(1, sample));
    this._buf[this._bufLen++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    if (this._bufLen >= FRAME_SAMPLES) {
      // Copiamos (no transferimos el buffer interno, lo seguimos usando).
      const out = this._buf.slice(0, this._bufLen);
      this.port.postMessage(out.buffer, [out.buffer]);
      this._bufLen = 0;
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0]; // mono
    if (!channel || channel.length === 0) return true;

    // Remuestreo lineal a 16 kHz, empujando cada muestra al buffer.
    let pos = this._frac;
    while (pos < channel.length) {
      this._push(channel[Math.floor(pos)] || 0);
      pos += this.ratio;
    }
    // Guardar el remanente fraccional para el próximo bloque.
    this._frac = pos - channel.length;
    return true;
  }
}

registerProcessor("voice-capture-processor", VoiceCaptureProcessor);
