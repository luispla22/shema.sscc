/* Shemá SSCC — Afinador
 *
 * Detecta la frecuencia fundamental del audio del micrófono mediante
 * autocorrelación (variante NSDF — Normalized Squared Difference Function),
 * la convierte a la nota más cercana y muestra la desviación en cents.
 *
 * Sin librerías. Web Audio API + getUserMedia. Necesita HTTPS o localhost.
 */

'use strict';

(function () {
  const NOTE_NAMES_SPA = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
  const NOTE_NAMES_AME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const A4 = 440;

  let audioCtx = null;
  let analyser = null;
  let stream = null;
  let sourceNode = null;
  let buffer = null;
  let rafId = 0;
  let active = false;

  function $(id) { return document.getElementById(id); }

  function getCipher() {
    const radios = document.getElementsByName && document.getElementsByName('cipher');
    if (radios) for (const r of radios) if (r.checked) return r.value;
    return 'spanish';
  }

  function freqToNote(freq) {
    if (freq <= 0) return null;
    // Semitonos por encima/abajo de A4 (440 Hz)
    const midiFloat = 69 + 12 * Math.log2(freq / A4);
    const midi = Math.round(midiFloat);
    const cents = Math.round((midiFloat - midi) * 100);
    const noteIdx = ((midi - 12) % 12 + 12) % 12; // 0=Do
    const octave = Math.floor((midi - 12) / 12);
    const cipher = getCipher();
    const names = cipher === 'american' ? NOTE_NAMES_AME : NOTE_NAMES_SPA;
    return { name: names[noteIdx], octave, cents, midi, freq };
  }

  /**
   * NSDF — autocorrelación normalizada. Devuelve la frecuencia fundamental
   * detectada o -1 si no hay tono claro.
   * Implementación basada en el algoritmo de McLeod & Wyvill (2005).
   */
  function detectPitch(buf, sampleRate) {
    const SIZE = buf.length;
    // RMS — descartar silencio
    let rms = 0;
    for (let i = 0; i < SIZE; i += 1) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return -1;

    // Encontrar el primer pico significativo en la autocorrelación
    let bestOffset = -1;
    let bestCorr = 0;
    let lastCorrelation = 1;
    let foundGoodCorrelation = false;
    const correlations = new Array(SIZE);

    const minLag = Math.floor(sampleRate / 2000); // tope alto = 2000 Hz
    const maxLag = Math.floor(sampleRate / 50);   // tope bajo = 50 Hz

    for (let offset = minLag; offset < maxLag; offset += 1) {
      let correlation = 0;
      for (let i = 0; i < SIZE - offset; i += 1) {
        correlation += Math.abs(buf[i] - buf[i + offset]);
      }
      correlation = 1 - (correlation / (SIZE - offset));
      correlations[offset] = correlation;

      if (correlation > 0.9 && correlation > lastCorrelation) {
        foundGoodCorrelation = true;
        if (correlation > bestCorr) {
          bestCorr = correlation;
          bestOffset = offset;
        }
      } else if (foundGoodCorrelation) {
        // pasamos el pico, refinar con interpolación cuadrática
        const shift = (correlations[bestOffset + 1] - correlations[bestOffset - 1])
                    / (2 * (2 * correlations[bestOffset] - correlations[bestOffset + 1] - correlations[bestOffset - 1]));
        return sampleRate / (bestOffset + (isFinite(shift) ? shift : 0));
      }
      lastCorrelation = correlation;
    }

    if (bestCorr > 0.01) {
      return sampleRate / bestOffset;
    }
    return -1;
  }

  function update() {
    if (!active || !analyser || !buffer) return;
    analyser.getFloatTimeDomainData(buffer);
    const freq = detectPitch(buffer, audioCtx.sampleRate);

    const noteEl = $('tunerNote');
    const freqEl = $('tunerFreq');
    const needleEl = $('tunerNeedle');
    const hintEl = $('tunerHint');

    if (freq < 0) {
      if (noteEl) noteEl.textContent = '—';
      if (freqEl) freqEl.textContent = '— Hz';
      if (needleEl) {
        needleEl.style.transform = 'translateX(0)';
        needleEl.dataset.tuned = 'none';
      }
      if (hintEl) hintEl.textContent = 'Toca una nota…';
    } else {
      const note = freqToNote(freq);
      if (note) {
        if (noteEl) noteEl.textContent = note.name;
        if (freqEl) freqEl.textContent = `${freq.toFixed(1)} Hz`;
        // Aguja: -50 cents → -100% offset, +50 cents → +100% offset
        const pct = Math.max(-1, Math.min(1, note.cents / 50));
        if (needleEl) {
          needleEl.style.transform = `translateX(${pct * 50}%)`;
          if (Math.abs(note.cents) <= 5) needleEl.dataset.tuned = 'good';
          else if (Math.abs(note.cents) <= 15) needleEl.dataset.tuned = 'close';
          else needleEl.dataset.tuned = 'off';
        }
        if (hintEl) {
          if (Math.abs(note.cents) <= 5) hintEl.textContent = 'Afinada';
          else if (note.cents > 0) hintEl.textContent = `Demasiado alta · +${note.cents}¢`;
          else hintEl.textContent = `Demasiado baja · ${note.cents}¢`;
        }
      }
    }

    rafId = requestAnimationFrame(update);
  }

  async function start() {
    const toggleBtn = $('tunerToggle');
    const panel = $('tunerPanel');
    const labelEl = toggleBtn?.querySelector('.tuner__toggle-label');
    const hintEl = $('tunerHint');

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
    } catch (err) {
      if (hintEl) hintEl.textContent = 'No se ha podido acceder al micrófono. Revisa los permisos del navegador.';
      if (panel) panel.hidden = false;
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    sourceNode = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    sourceNode.connect(analyser);
    buffer = new Float32Array(analyser.fftSize);

    active = true;
    if (panel) panel.hidden = false;
    if (toggleBtn) toggleBtn.classList.add('is-active');
    if (labelEl) labelEl.textContent = 'Apagar afinador';
    if (hintEl) hintEl.textContent = 'Toca una nota…';

    update();
  }

  function stop() {
    active = false;
    cancelAnimationFrame(rafId);
    if (sourceNode) try { sourceNode.disconnect(); } catch {}
    sourceNode = null;
    if (analyser) try { analyser.disconnect(); } catch {}
    analyser = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    buffer = null;

    const toggleBtn = $('tunerToggle');
    const panel = $('tunerPanel');
    const labelEl = toggleBtn?.querySelector('.tuner__toggle-label');
    if (panel) panel.hidden = true;
    if (toggleBtn) toggleBtn.classList.remove('is-active');
    if (labelEl) labelEl.textContent = 'Activar afinador';
  }

  function init() {
    const btn = $('tunerToggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (active) stop();
      else start();
    });

    // Apagar al salir/cerrar pestaña
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && active) stop();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
