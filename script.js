/* Shemá SSCC — Motor de transposición de acordes
 *
 * Reescrito sobre la base original de A. González SJ (AMDG).
 * Mejoras:
 *  - Parser de acordes con expresión regular robusta (notas españolas y americanas).
 *  - Soporte completo de slash chords (Sol/Si → Sol#/Do).
 *  - Selección enarmónica por tonalidad: detecta la tónica y elige sostenidos o
 *    bemoles consistentes en toda la canción tras transponer.
 *  - Detección de líneas de acordes con varias señales (proporción, densidad de
 *    espacios, mayúsculas, modificadores) — evita falsos positivos como
 *    "Si la fe...".
 *  - Posicionamiento estable: respeta la posición original de cada acorde
 *    aunque cambie de longitud.
 *  - Memoización: parsea cada canción una sola vez; al transponer sólo se
 *    recalcula la salida.
 *  - API pública compatible con el HTML existente.
 */

'use strict';

const OCTAVE = 12;

const NOTE_TO_PC = Object.freeze({
  // español
  do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11,
  // americano
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
});

const SHARP_SCALE_SPA = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const FLAT_SCALE_SPA  = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
const SHARP_SCALE_AME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_SCALE_AME  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Tonalidades mayores con bemoles en su armadura. El resto usan sostenidos.
// Nota: F mayor (pc=5) usa Bb en su armadura → bemoles.
const FLAT_KEY_PCS = new Set([5, 10, 3, 8, 1, 6]); // F, Bb, Eb, Ab, Db, Gb

// Stop-list: palabras españolas comunes que también son notas. Si aparecen en
// minúscula no las tratamos como acordes — los acordes siempre se capitalizan.
const SPANISH_STOPWORDS = new Set([
  'la', 'el', 'mi', 'do', 'si', 'fa', 're', 'sol', 'que', 'de', 'es', 'un',
  'una', 'lo', 'le', 'me', 'te', 'se', 'su', 'tu', 'ya', 'no', 'en', 'al',
  'por', 'con', 'sin', 'a', 'y', 'o', 'u', 'e',
]);

let currentScaleSharp = SHARP_SCALE_SPA;
let currentScaleFlat = FLAT_SCALE_SPA;
let currentNotation = 'spanish';

function setCipherSpa() {
  currentScaleSharp = SHARP_SCALE_SPA;
  currentScaleFlat = FLAT_SCALE_SPA;
  currentNotation = 'spanish';
}

function setCipherAme() {
  currentScaleSharp = SHARP_SCALE_AME;
  currentScaleFlat = FLAT_SCALE_AME;
  currentNotation = 'american';
}

/* -------------------------------------------------------------------------
 * Parser de acordes
 * ------------------------------------------------------------------------- */

const CHORD_RE = (() => {
  // Notas: español (do, re, mi, fa, sol, la, si) o americano (a-g).
  // Las españolas se prueban primero porque son más largas y específicas.
  const note = '(do|re|mi|fa|sol|la|si|[a-g])';
  const accidental = '(#|b)?';
  const quality = '(m(?!aj)|maj|min|dim|aug|sus[24]?|°|\\+)?';
  const ext = '(\\d{1,2})?';
  const altExt = '((?:add\\d+|b\\d+|#\\d+|sus[24]?)*)';
  const bass = `(?:/${note}${accidental})?`;
  return new RegExp(`^${note}${accidental}${quality}${ext}${altExt}${bass}$`, 'i');
})();

/**
 * Parsea un token sabiendo que estamos en una línea ya identificada como
 * chord-line. Aplica la convención de cancioneros españoles: si la nota
 * está en minúscula y no tiene calificador, es un acorde MENOR.
 *   "DO" → Do mayor, "do" → Do menor, "MI" → Mi mayor, "mi" → Mi menor.
 */
function parseChordInChordLine(token) {
  const parsed = parseChord(token);
  if (!parsed) return null;
  // Si la raíz va en minúscula y no se especificó calidad, marcar como minor
  const rootRaw = parsed.rootRaw || '';
  const isLowerRoot = rootRaw && rootRaw === rootRaw.toLowerCase();
  if (isLowerRoot && !parsed.quality && !parsed.ext) {
    parsed.quality = 'm';
  }
  return parsed;
}

function parseChord(token) {
  if (!token) return null;
  // Quitar paréntesis envolventes: (Do) → Do
  if (token.startsWith('(') && token.endsWith(')')) {
    token = token.slice(1, -1);
  }
  const m = CHORD_RE.exec(token);
  if (!m) return null;

  const [, rootRaw, accRaw, qualRaw, extRaw, altRaw, bassRaw, bassAccRaw] = m;
  const rootKey = rootRaw.toLowerCase();
  if (!(rootKey in NOTE_TO_PC)) return null;

  let pc = NOTE_TO_PC[rootKey];
  if (accRaw === '#') pc = (pc + 1) % OCTAVE;
  else if (accRaw === 'b') pc = (pc + OCTAVE - 1) % OCTAVE;

  const original = token;
  const rootCase = detectCase(rootRaw);

  let bassPc = null;
  let bassCase = null;
  let bassRawText = null;
  if (bassRaw) {
    const bassKey = bassRaw.toLowerCase();
    if (bassKey in NOTE_TO_PC) {
      bassPc = NOTE_TO_PC[bassKey];
      if (bassAccRaw === '#') bassPc = (bassPc + 1) % OCTAVE;
      else if (bassAccRaw === 'b') bassPc = (bassPc + OCTAVE - 1) % OCTAVE;
      bassCase = detectCase(bassRaw);
      bassRawText = bassRaw;
    }
  }

  return {
    original,
    rootPc: pc,
    rootCase,
    rootRaw,
    accidental: accRaw || '',
    quality: qualRaw || '',
    ext: extRaw || '',
    altExt: altRaw || '',
    bassPc,
    bassCase,
    bassRawText,
    length: token.length,
  };
}

function detectCase(s) {
  if (!s) return 'mixed';
  if (s === s.toUpperCase()) return 'upper';
  if (s === s.toLowerCase()) return 'lower';
  // primera letra mayúscula, resto minúscula → "Title"
  if (s[0] === s[0].toUpperCase() && s.slice(1) === s.slice(1).toLowerCase()) return 'title';
  return 'mixed';
}

function applyCase(s, mode) {
  switch (mode) {
    case 'upper': return s.toUpperCase();
    case 'lower': return s.toLowerCase();
    case 'title': return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1).toLowerCase();
    default: return s;
  }
}

/* -------------------------------------------------------------------------
 * Detección de líneas de acordes
 * ------------------------------------------------------------------------- */

const TOKEN_RE = /\S+/g;

function tokenizeWithPositions(line) {
  const tokens = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    const raw = m[0];
    const startPos = m.index;
    // Sub-tokenizar por guión: "SIm-LA" → ["SIm", "LA"] manteniendo posiciones.
    // Sólo aplica si TODAS las partes son acordes válidos (evitar romper
    // palabras con guión en líneas de letra).
    if (raw.includes('-')) {
      const parts = raw.split('-');
      const allChords = parts.every(p => p.length > 0 && parseChordRaw(p));
      if (allChords) {
        let offset = 0;
        for (const p of parts) {
          tokens.push({ text: p, position: startPos + offset });
          offset += p.length + 1; // +1 por el guión
        }
        continue;
      }
    }
    tokens.push({ text: raw, position: startPos });
  }
  return tokens;
}

// Versión sin recorte de paréntesis para uso interno
function parseChordRaw(token) {
  if (!token) return null;
  return CHORD_RE.test(token) ? true : null;
}

// Etiquetas de anotación que pueden ir solas en su línea o como prefijo seguido de acordes:
//   "Cej.4"                       → toda la línea es anotación
//   "Cej.3 (admite más)"          → toda la línea es anotación (con comentario)
//   "Traste 3" / "Capo traste 2"  → anotación de cejilla
//   "2ª vez: SOL LA7 RE"          → prefijo "2ª vez:" es anotación, el resto se transpone
// Permitimos opcionalmente un comentario final entre paréntesis: " (admite más)"
const ANNOTATION_PREFIX_RE = /^\s*(cej(illa)?[\s.:,-]*[ivx\d]+(\s*[-–/y]\s*[ivx\d]+)?|capo(\s+traste)?[\s.:,-]*[ivx\d]+(\s*[-–/y]\s*[ivx\d]+)?|traste[\s.:,-]*[ivx\d]+(\s*[-–/y]\s*[ivx\d]+)?|tono\s*:?\s*[a-z#♯♭b]*|estribillo|coro|bis|intro|outro|final|puente|solo|recitado|\d+[ªº]\s*vez|\d+[ªº])(\s*\([^)]*\))?\s*[:.\-]?\s*/i;
// "C2", "C5" sueltos = abreviatura de "Capo 2"; admite "C3 (admite más)"
const CAPO_SHORT_RE = /^\s*c\s*\d{1,2}(\s*\([^)]*\))?\s*$/i;

function isAnnotationLine(line) {
  if (CAPO_SHORT_RE.test(line)) return true;
  // Es anotación pura sólo si el prefijo cubre prácticamente toda la línea
  const m = ANNOTATION_PREFIX_RE.exec(line);
  if (!m) return false;
  return m[0].trim().length === line.trim().length;
}

// Devuelve { label, rest, restOffset } si la línea empieza con anotación seguida
// de algo (típicamente acordes), o null si no es el caso.
function splitAnnotationPrefix(line) {
  const m = ANNOTATION_PREFIX_RE.exec(line);
  if (!m) return null;
  const consumed = m[0];
  // si toda la línea es la anotación, no hay split
  if (consumed.trim().length === line.trim().length) return null;
  // si lo que queda no contiene acordes, no es split (es texto continuado)
  const rest = line.slice(consumed.length);
  return {
    label: consumed.trim().replace(/[:.\-]\s*$/, ''),
    rest,
    restOffset: consumed.length,
  };
}

function isLikelyChordLine(line) {
  if (isAnnotationLine(line)) return false;
  const tokens = tokenizeWithPositions(line);
  if (tokens.length === 0) return false;

  let chordCount = 0;
  let stopwordCount = 0;
  let normalCount = 0;
  let hasModifier = false;
  let hasUppercaseChord = false;

  for (const tok of tokens) {
    const lower = tok.text.toLowerCase();
    const parsed = parseChord(tok.text);

    if (parsed) {
      // si está completamente en minúscula y está en la stop-list, es palabra
      if (tok.text === lower && SPANISH_STOPWORDS.has(lower)) {
        stopwordCount += 1;
      } else {
        chordCount += 1;
        if (parsed.quality || parsed.ext || parsed.altExt || parsed.accidental || parsed.bassPc !== null) {
          hasModifier = true;
        }
        // detecta convención de mayúsculas (autor del cancionero)
        if (tok.text[0] === tok.text[0].toUpperCase() && tok.text[0] !== tok.text[0].toLowerCase()) {
          hasUppercaseChord = true;
        }
      }
    } else {
      normalCount += 1;
    }
  }

  if (chordCount === 0) return false;

  // todos los tokens son acordes (sin palabras normales ni stopwords) →
  // línea de acordes incluso si es uno solo, p.ej. "SOL" en su propia línea
  if (chordCount === tokens.length) return true;

  // Convención de cancionero: si la línea mezcla acordes en mayúscula con
  // notas en minúscula (mi, la, do, sol...), las minúsculas son acordes
  // menores ("DO mi" = Do mayor, mi menor). Toda la línea es chord-line.
  if (hasUppercaseChord && chordCount + stopwordCount === tokens.length) return true;

  // señal fuerte: hay un acorde con modificador (e.g. "Do7", "Solm")
  if (hasModifier && chordCount >= normalCount) return true;

  // mayoría de tokens son acordes y no hay palabras normales largas
  const longNormal = tokens.filter(t => !parseChord(t.text) && t.text.length > 3).length;
  if (longNormal > 0) return false;

  // densidad de espacios: las líneas de acordes tienen huecos grandes
  const spaceRuns = (line.match(/ {2,}/g) || []).length;
  const denseSpacing = spaceRuns >= Math.max(1, tokens.length - 1) * 0.4;

  if (chordCount > normalCount + stopwordCount && denseSpacing) return true;

  return false;
}

/* -------------------------------------------------------------------------
 * Selección enarmónica por tonalidad
 * ------------------------------------------------------------------------- */

function detectKey(chordObjects) {
  if (chordObjects.length === 0) return { pc: 0, prefersFlat: false };

  // heurística: la tónica suele ser el primer o el último acorde (el que
  // aparece más como acorde sin slash bass es buen candidato).
  const counts = new Map();
  for (const c of chordObjects) {
    counts.set(c.rootPc, (counts.get(c.rootPc) || 0) + 1);
  }
  const first = chordObjects[0].rootPc;
  const last = chordObjects[chordObjects.length - 1].rootPc;

  // damos peso extra al primero y al último
  counts.set(first, (counts.get(first) || 0) + 2);
  counts.set(last, (counts.get(last) || 0) + 3);

  let best = first;
  let bestScore = -1;
  for (const [pc, score] of counts) {
    if (score > bestScore) { best = pc; bestScore = score; }
  }

  // ¿Tonalidad original con bemoles? Miramos si los acordes usan más bemoles
  // que sostenidos.
  let flats = 0;
  let sharps = 0;
  for (const c of chordObjects) {
    if (c.accidental === 'b') flats += 1;
    else if (c.accidental === '#') sharps += 1;
  }
  const prefersFlat = flats > sharps;

  return { pc: best, prefersFlat };
}

function shouldUseFlatScale(originalKey, shift) {
  const newPc = (originalKey.pc + shift + OCTAVE) % OCTAVE;
  // si la tonalidad nueva está en la familia bemol → usamos bemoles.
  // si la tonalidad original ya prefería bemoles y la nueva es ambigua
  // (tonalidad blanca C/G/D/A/E/B), respetamos la preferencia.
  if (FLAT_KEY_PCS.has(newPc)) return true;
  if (originalKey.prefersFlat && (newPc === 0 || newPc === 5)) return true;
  return false;
}

/* -------------------------------------------------------------------------
 * Transposición
 * ------------------------------------------------------------------------- */

function renderNoteName(pc, useFlat) {
  const scale = useFlat ? currentScaleFlat : currentScaleSharp;
  return scale[(pc + OCTAVE) % OCTAVE];
}

function transposeChord(chord, shift, useFlat) {
  const newRootPc = (chord.rootPc + shift + OCTAVE) % OCTAVE;
  // Notación canónica: primera letra mayúscula, resto minúscula.
  // El acento (b/#) y los modificadores conservan minúsculas.
  const root = renderNoteName(newRootPc, useFlat);
  const middle = `${chord.quality}${chord.ext}${chord.altExt}`;

  let bass = '';
  if (chord.bassPc !== null) {
    const newBassPc = (chord.bassPc + shift + OCTAVE) % OCTAVE;
    bass = '/' + renderNoteName(newBassPc, useFlat);
  }

  return root + middle + bass;
}

/* -------------------------------------------------------------------------
 * Posicionamiento estable
 * Reconstruye la línea de acordes manteniendo las posiciones originales.
 * Si un acorde nuevo es más largo y no cabe sin invadir el siguiente, recorta
 * los espacios siguientes (mínimo 1 espacio entre acordes).
 * ------------------------------------------------------------------------- */

function renderChordLine(originalLine, parsedChords, shift, useFlat) {
  if (parsedChords.length === 0) return originalLine;

  const transposed = parsedChords.map(c => ({
    position: c.position,
    text: transposeChord(c.chord, shift, useFlat),
  }));

  let output = '';
  for (let i = 0; i < transposed.length; i += 1) {
    const cur = transposed[i];
    const next = transposed[i + 1];
    if (output.length < cur.position) {
      output += ' '.repeat(cur.position - output.length);
    }
    output += cur.text;
    if (next) {
      const minSpace = 1;
      const targetEnd = Math.max(output.length + minSpace, next.position);
      if (targetEnd > next.position) {
        // el acorde actual invade — desplazamos el siguiente
        next.position = targetEnd;
      }
    }
  }
  return output;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderChordLineHtml(originalLine, parsedChords, shift, useFlat) {
  if (parsedChords.length === 0) return escapeHtml(originalLine);

  const transposed = parsedChords.map(c => ({
    position: c.position,
    text: transposeChord(c.chord, shift, useFlat),
  }));

  let html = '';
  let visibleLen = 0;
  for (let i = 0; i < transposed.length; i += 1) {
    const cur = transposed[i];
    const next = transposed[i + 1];
    if (visibleLen < cur.position) {
      html += ' '.repeat(cur.position - visibleLen);
      visibleLen = cur.position;
    }
    html += `<span class="chord">${escapeHtml(cur.text)}</span>`;
    visibleLen += cur.text.length;
    if (next) {
      const minSpace = 1;
      const targetEnd = Math.max(visibleLen + minSpace, next.position);
      if (targetEnd > next.position) {
        next.position = targetEnd;
      }
    }
  }
  return html;
}

/* -------------------------------------------------------------------------
 * Procesado de un texto completo
 * Memoizado: parsea una sola vez por texto. Al transponer sólo recalcula la
 * salida usando la representación intermedia.
 * ------------------------------------------------------------------------- */

let cachedSource = null;
let cachedParsed = null;
let cachedNotation = null;

function parseSong(text) {
  const lines = text.split('\n');
  const result = [];
  const allChords = [];

  for (const line of lines) {
    // Caso especial: línea con prefijo de anotación + acordes
    //   "2ª vez: SOL LA7 RE" → { label: "2ª vez:", chords: [SOL, LA7, RE] }
    const split = splitAnnotationPrefix(line);
    if (split && isLikelyChordLine(split.rest)) {
      const tokens = tokenizeWithPositions(split.rest);
      const chords = [];
      for (const tok of tokens) {
        const parsed = parseChordInChordLine(tok.text);
        if (parsed) {
          chords.push({ chord: parsed, position: tok.position + split.restOffset });
          allChords.push(parsed);
        }
      }
      result.push({ type: 'annotated-chord', original: line, label: split.label, chords });
      continue;
    }

    if (isLikelyChordLine(line)) {
      const tokens = tokenizeWithPositions(line);
      const chords = [];
      for (const tok of tokens) {
        const parsed = parseChordInChordLine(tok.text);
        if (parsed) {
          chords.push({ chord: parsed, position: tok.position });
          allChords.push(parsed);
        }
      }
      result.push({ type: 'chord', original: line, chords });
    } else {
      result.push({ type: 'text', original: line });
    }
  }

  const key = detectKey(allChords);
  return { lines: result, key };
}

function ensureParsed(source) {
  if (cachedSource === source && cachedNotation === currentNotation && cachedParsed) {
    return cachedParsed;
  }
  cachedSource = source;
  cachedNotation = currentNotation;
  cachedParsed = parseSong(source);
  return cachedParsed;
}

function invalidateCache() {
  cachedSource = null;
  cachedParsed = null;
  cachedNotation = null;
}

/* -------------------------------------------------------------------------
 * Detección automática de cifrado
 * ------------------------------------------------------------------------- */

function detectCipher(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let spaCount = 0;
  let ameCount = 0;
  for (const tok of tokens) {
    const m = CHORD_RE.exec(tok);
    if (!m) continue;
    const root = m[1].toLowerCase();
    if (['do', 're', 'mi', 'fa', 'sol', 'la', 'si'].includes(root)) spaCount += 1;
    else if (['c', 'd', 'e', 'f', 'g', 'a', 'b'].includes(root)) ameCount += 1;
  }
  return ameCount > spaCount ? 'american' : 'spanish';
}

/* -------------------------------------------------------------------------
 * API pública (compatible con el HTML)
 * ------------------------------------------------------------------------- */

function getFormText() {
  const ta = document.getElementById('song-input');
  return ta ? ta.value : '';
}

function getCipherSelection() {
  const radios = document.getElementsByName('cipher');
  for (const r of radios) if (r.checked) return r.value;
  return 'spanish';
}

function getShift() {
  const lbl = document.getElementById('shift-label');
  if (!lbl) return 0;
  return parseInt(lbl.textContent || '0', 10) || 0;
}

function setShift(value) {
  const lbl = document.getElementById('shift-label');
  if (lbl) lbl.textContent = String(value);
}

/**
 * Renderiza un par chord-line + lyric-line como una sola línea de letra
 * proporcional con los acordes flotando como pills sobre el carácter de la
 * letra que está en el mismo índice de columna que tenía el acorde en su
 * línea original. Esto preserva la intención del editor del Google Doc
 * ("Sol va sobre la 'a' de 'creación'") independientemente de la fuente.
 *
 * Acordes muy próximos (≤3 caracteres de distancia) se fusionan en una sola
 * pill ("Sol La7") para evitar solape visual.
 */
function renderAnchoredPair(chordSeg, lyricSeg, shift, useFlat) {
  const lyric = lyricSeg.original || '';
  const chordLine = chordSeg.original || '';
  const chords = chordSeg.chords || [];

  const transposed = chords.map(c => ({
    pos: c.position,
    text: transposeChord(c.chord, shift, useFlat),
  }));

  if (!lyric.trim()) {
    return `<div class="line-group">`
      + `<div class="line line--chords">${renderChordLineHtml(chordSeg.original, chordSeg.chords, shift, useFlat)}</div>`
      + `</div>`;
  }

  // Renderizamos cada carácter de la letra en un span — sirve para medir
  // y para que la línea respete el flujo natural en proporcional.
  let lyricHtml = '';
  for (let i = 0; i < lyric.length; i += 1) {
    const ch = lyric[i];
    const safe = ch === ' ' ? '&nbsp;' : escapeHtml(ch);
    lyricHtml += `<span class="ch">${safe}</span>`;
  }

  // Línea de acordes invisible para medición. La renderizamos en la misma
  // fuente que la letra (proporcional) para que las posiciones de los
  // acordes (computadas tras layout) reflejen lo que el editor del doc
  // intentaba comunicar: la posición visual de cada acorde EN SU PROPIA
  // LÍNEA, no la posición del carácter del mismo índice en la letra.
  let measureHtml = '';
  for (let i = 0; i < chordLine.length; i += 1) {
    const ch = chordLine[i];
    const safe = ch === ' ' ? '&nbsp;' : escapeHtml(ch);
    measureHtml += `<span class="mch">${safe}</span>`;
  }

  const pillsHtml = transposed.map(t => {
    return `<span class="floating-chord" data-target="${t.pos}">${escapeHtml(t.text)}</span>`;
  }).join('');

  return `<div class="line-group line-group--anchored">`
    + `<div class="anchored-stage">`
    + `<div class="chord-line-measuring" aria-hidden="true">${measureHtml}</div>`
    + `<div class="floating-chords">${pillsHtml}</div>`
    + `<div class="line line-anchored">${lyricHtml}</div>`
    + `</div>`
    + `</div>`;
}

/**
 * Mide la posición real (en píxeles) de cada acorde dentro de la línea de
 * acordes invisible, y asigna left:px a la pill flotante. Los caracteres
 * de la chord-line se miden con la MISMA fuente que la letra, de modo que
 * la relación visual chord ↔ lyric coincide con la del doc original
 * (donde editor también usaba una fuente proporcional consistente).
 */
function positionFloatingChords(rootEl) {
  const root = rootEl || document;
  const stages = root.querySelectorAll('.anchored-stage');
  for (const stage of stages) {
    const pills = Array.from(stage.querySelectorAll('.floating-chord'));
    const measureChars = stage.querySelectorAll('.chord-line-measuring .mch');
    if (!pills.length || !measureChars.length) continue;
    const stageRect = stage.getBoundingClientRect();
    if (stageRect.width === 0) continue;

    const placements = pills.map(pill => {
      const targetIdx = parseInt(pill.dataset.target, 10) || 0;
      const charEl = measureChars[Math.min(targetIdx, measureChars.length - 1)];
      const charRect = charEl.getBoundingClientRect();
      return { pill, left: charRect.left - stageRect.left };
    });
    placements.sort((a, b) => a.left - b.left);

    const survivors = [];
    for (const p of placements) {
      const last = survivors[survivors.length - 1];
      if (last) {
        const lastW = last.pill.textContent.length * 7.2 + 12;
        if (p.left < last.left + lastW + 2) {
          last.pill.textContent = last.pill.textContent + ' ' + p.pill.textContent;
          p.pill.remove();
          continue;
        }
      }
      p.pill.style.left = `${Math.max(0, p.left)}px`;
      survivors.push(p);
    }
  }
}

function processText() {
  const cipher = getCipherSelection();
  if (cipher === 'american') setCipherAme();
  else setCipherSpa();

  const shift = getShift();
  const text = getFormText();
  const display = document.getElementById('display');
  if (!display) return;

  let titleEl = display.querySelector('.display__title');
  let body = display.querySelector('.display__body');
  if (!body) {
    body = document.createElement('div');
    body.className = 'display__body';
    display.appendChild(body);
  }

  if (!text || !text.trim()) {
    body.replaceChildren();
    if (titleEl) titleEl.remove();
    display.dataset.empty = 'true';
    return;
  }

  const parsed = ensureParsed(text);
  const useFlat = shouldUseFlatScale(parsed.key, shift);

  // Extraer la primera línea como título si es una línea de letra no vacía.
  let bodyLines = parsed.lines;
  let titleText = '';
  if (bodyLines.length > 0 && bodyLines[0].type === 'text' && bodyLines[0].original.trim()) {
    titleText = bodyLines[0].original.trim();
    bodyLines = bodyLines.slice(1);
    while (bodyLines.length > 0 && bodyLines[0].type === 'text' && !bodyLines[0].original.trim()) {
      bodyLines = bodyLines.slice(1);
    }
  }

  if (titleText) {
    if (!titleEl) {
      titleEl = document.createElement('h2');
      titleEl.className = 'display__title';
      display.insertBefore(titleEl, body);
    }
    titleEl.textContent = titleText;
  } else if (titleEl) {
    titleEl.remove();
  }

  // Agrupar líneas en pares (acorde + letra) o singletons. Cada grupo se
  // marca con break-inside: avoid para que las columnas no partan un acorde
  // de su letra correspondiente, pero sí pueden separar grupos.
  const renderLine = (seg) => {
    if (seg.type === 'text' && seg.original.trim() && isAnnotationLine(seg.original)) {
      return `<div class="line line--annotation">${escapeHtml(seg.original.trim())}</div>`;
    }
    if (seg.type === 'annotated-chord') {
      const chordsHtml = renderChordLineHtml(seg.original.replace(/^.*?(?=\S)/, m => ' '.repeat(m.length)), seg.chords, shift, useFlat);
      // Renderizamos: pill con la etiqueta + línea de acordes transpuestos
      return `<div class="line line--annotated"><span class="annotation-pill">${escapeHtml(seg.label)}</span><span class="line--chords-inline">${chordsHtml.trimStart()}</span></div>`;
    }
    const cls = seg.type === 'chord' ? 'line line--chords' : 'line line--lyric';
    const html = seg.type === 'chord'
      ? renderChordLineHtml(seg.original, seg.chords, shift, useFlat)
      : escapeHtml(seg.original) || '&nbsp;';
    return `<div class="${cls}">${html}</div>`;
  };

  // Agrupamos en estrofas para que las columnas no rompan versos a la mitad.
  // Una estrofa empieza:
  //   - tras una línea en blanco
  //   - en una línea de anotación pura ("Cej.4", "Estribillo:")
  //   - en una línea de anotación + acordes ("2ª VEZ: Sol La7 Re")
  // Cada estrofa lleva break-inside: avoid; si no cabe en la columna actual,
  // pasa entera a la siguiente.
  const stanzas = [];
  let current = [];
  const flushStanza = () => {
    if (current.length) { stanzas.push(current); current = []; }
  };

  let i = 0;
  while (i < bodyLines.length) {
    const seg = bodyLines[i];

    if (seg.type === 'text' && !seg.original.trim()) {
      flushStanza();
      stanzas.push('break');
      i += 1;
      continue;
    }

    // Anotación + acordes ("2ª VEZ Sol La7 Re") es una indicación de
    // repetición — semánticamente pertenece al contenido anterior. La
    // pegamos a la estrofa actual y la cerramos, para que la SIGUIENTE
    // estrofa empiece limpia.
    if (seg.type === 'annotated-chord') {
      current.push(renderLine(seg));
      flushStanza();
      i += 1;
      continue;
    }

    // Anotación pura ("Estribillo:", "Coro:") introduce nueva sección →
    // empieza nueva estrofa con la anotación dentro.
    const isPureAnnotation = seg.type === 'text' && isAnnotationLine(seg.original);
    if (isPureAnnotation && current.length > 0) flushStanza();

    const next = bodyLines[i + 1];
    const nextIsLyric = next && next.type === 'text' && next.original.trim()
                       && !isAnnotationLine(next.original);

    if (seg.type === 'chord' && nextIsLyric) {
      current.push(renderAnchoredPair(seg, next, shift, useFlat));
      i += 2;
    } else {
      current.push(renderLine(seg));
      i += 1;
    }
  }
  flushStanza();

  body.innerHTML = stanzas.map(s =>
    s === 'break'
      ? '<div class="stanza-break"></div>'
      : `<div class="stanza">${s.join('')}</div>`
  ).join('');
  display.dataset.empty = 'false';

  // Posicionar pills flotantes según el carácter destino real de la letra.
  // Lo hacemos en el siguiente frame para que los anchos estén calculados.
  requestAnimationFrame(() => positionFloatingChords(body));
}

function incrementShiftCh() {
  let s = getShift() + 1;
  if (s > 11) s -= OCTAVE;
  setShift(s);
  processText();
}

function decrementShiftCh() {
  let s = getShift() - 1;
  if (s < -11) s += OCTAVE;
  setShift(s);
  processText();
}

function resetShiftCh() {
  setShift(0);
  processText();
}

function centerView(elemId) {
  const el = document.getElementById(elemId);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Forzar re-parseo cuando el texto del input cambie (canción nueva).
if (typeof document !== 'undefined') {
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'song-input') {
      invalidateCache();
    }
  });

  // Toggle de modo expandido en el display
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('#expandToggle');
    if (btn) {
      const expanded = document.body.classList.toggle('is-expanded');
      btn.setAttribute('aria-label',
        expanded ? 'Volver a la vista normal' : 'Expandir vista de la canción');
      if (expanded) {
        document.documentElement.scrollTo({ top: 0, behavior: 'instant' });
        autoFitColumns();
      } else {
        const body = document.querySelector('.display__body');
        if (body) body.removeAttribute('data-cols');
      }
      return;
    }

    // Tab para colapsar/abrir el sidebar (lista de canciones)
    const sBtn = e.target.closest && e.target.closest('#collapseSidebar');
    if (sBtn) {
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      try { localStorage.setItem('shema-sidebar-collapsed', collapsed ? '1' : '0'); } catch {}
      sBtn.title = collapsed ? 'Mostrar lista' : 'Ocultar lista';
      return;
    }

    // Tab para colapsar/abrir los controles
    const cBtn = e.target.closest && e.target.closest('#collapseControls');
    if (cBtn) {
      const collapsed = document.body.classList.toggle('controls-collapsed');
      try { localStorage.setItem('shema-controls-collapsed', collapsed ? '1' : '0'); } catch {}
      cBtn.title = collapsed ? 'Mostrar controles' : 'Ocultar controles';
      // Reposicionar pills tras el cambio de ancho
      setTimeout(() => {
        const body = document.querySelector('.display__body');
        if (body) positionFloatingChords(body);
      }, 320);
      return;
    }
  });

  // Restaurar estado de paneles desde localStorage
  try {
    if (localStorage.getItem('shema-sidebar-collapsed') === '1') {
      document.body.classList.add('sidebar-collapsed');
    }
    if (localStorage.getItem('shema-controls-collapsed') === '1') {
      document.body.classList.add('controls-collapsed');
    }
  } catch {}

  // Salir del modo expandido con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('is-expanded')) {
      document.body.classList.remove('is-expanded');
      const body = document.querySelector('.display__body');
      if (body) body.removeAttribute('data-cols');
    }
  });

  // Reajustar columnas al cambiar tamaño/orientación + reposicionar pills
  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (document.body.classList.contains('is-expanded')) autoFitColumns();
      const body = document.querySelector('.display__body');
      if (body) positionFloatingChords(body);
    });
  });

  // Reajustar columnas tras transponer (el contenido cambia tamaño levemente)
  const origProcess = window.processText;
  if (origProcess) {
    window.processText = function (...args) {
      const r = origProcess.apply(this, args);
      if (document.body.classList.contains('is-expanded')) {
        requestAnimationFrame(autoFitColumns);
      }
      return r;
    };
  }
}

function autoFitColumns() {
  const body = document.querySelector('.display__body');
  if (!body) return;
  const viewportWidth = window.innerWidth;
  if (viewportWidth < 1024) {
    body.removeAttribute('data-cols');
    return;
  }
  // Medir altura natural en una sola columna (sin constraint)
  body.removeAttribute('data-cols');
  const naturalHeight = body.scrollHeight;
  // Estimar altura disponible: viewport menos toolbar/título/padding (≈13rem)
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const availableHeight = window.innerHeight - 13 * remPx;

  // En multicol la tipografía baja ~14% (1.18rem → 1.02rem), así que damos
  // un margen de ~25% antes de forzar el split: si está sólo un poco por encima
  // del alto disponible, en realidad cabría en 1 col sin partir.
  // Sólo dividimos cuando el contenido es claramente más alto que el viewport.
  const overflowRatio = naturalHeight / availableHeight;
  if (overflowRatio <= 1.25) return;

  const maxCols = viewportWidth >= 1500 ? 3 : 2;
  // En multicol cada columna tendrá tipografía ~14% menor → multiplicamos por 0.86
  const effectiveHeight = naturalHeight * 0.86;
  const cols = Math.min(maxCols, Math.max(2, Math.ceil(effectiveHeight / availableHeight)));
  body.setAttribute('data-cols', String(cols));
}

// Exponer al ámbito global para los onclick="" del HTML.
if (typeof window !== 'undefined') {
  window.processText = processText;
  window.incrementShiftCh = incrementShiftCh;
  window.decrementShiftCh = decrementShiftCh;
  window.resetShiftCh = resetShiftCh;
  window.setCipherSpa = setCipherSpa;
  window.setCipherAme = setCipherAme;
  window.detectCipher = detectCipher;
  window.centerView = centerView;
  window.invalidateChordCache = invalidateCache;
  // exposiciones para tests
  window.__chordEngine = { parseChord, parseSong, detectKey, shouldUseFlatScale, transposeChord, isLikelyChordLine, isAnnotationLine, renderChordLine, renderChordLineHtml };
}
