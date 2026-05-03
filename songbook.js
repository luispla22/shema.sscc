/* Shemá SSCC — Cargador del cancionero
 *
 * Estrategia stale-while-revalidate:
 *  1. Si hay caché en localStorage < TTL → render inmediato.
 *  2. Fetch en background; si cambió, swap silencioso.
 *  3. Si caché ausente o expirado → render skeleton, fetch, render, guardar.
 *
 * Detalles:
 *  - Intenta primero fetch directo (Google Docs publicados suelen tener CORS
 *    abierto). Si falla, cae al proxy.
 *  - Carga no bloqueante: la UI se renderiza primero y el fetch se dispara
 *    tras requestIdleCallback / setTimeout(0).
 *  - Parseo en chunks usando requestIdleCallback para no congelar la página
 *    en documentos grandes.
 */

'use strict';

const DOC_URL = 'https://docs.google.com/document/d/e/2PACX-1vTHURbCa5PylOX-4MU3XMJF_xlEI1ECxTcJRXe8qkBGE2XKzAV57Sq-fHIZmxEfjA/pub';
const PROXY_FALLBACKS = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];
const CACHE_KEY = 'shema-songbook-v3';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

const state = {
  songs: [],
  sections: [],
  currentIdx: -1,
  loadedAt: null,
};

const dom = {};

function $(id) { return document.getElementById(id); }

function clean(s) { return (s || '').replace(/[\r\t]/g, ''); }

/* -------------------------------------------------------------------------
 * Caché
 * ------------------------------------------------------------------------- */

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.songs || !Array.isArray(parsed.songs)) return null;
    return parsed;
  } catch (err) {
    return null;
  }
}

function writeCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (err) {
    // ignorar quota exceeded
  }
}

function isFresh(cache) {
  if (!cache || !cache.fetchedAt) return false;
  return Date.now() - cache.fetchedAt < CACHE_TTL_MS;
}

/* -------------------------------------------------------------------------
 * Fetch con fallback a proxies
 * ------------------------------------------------------------------------- */

async function fetchDoc(url) {
  // 1. directo
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.ok) return await res.text();
  } catch (err) {
    // continuar a proxies
  }
  // 2. proxies
  for (const proxify of PROXY_FALLBACKS) {
    try {
      const res = await fetch(proxify(url), { cache: 'no-cache' });
      if (res.ok) return await res.text();
    } catch (err) {
      // probar siguiente
    }
  }
  throw new Error('No se pudo descargar el cancionero');
}

/* -------------------------------------------------------------------------
 * Parseo del HTML del Google Doc
 * ------------------------------------------------------------------------- */

// Extrae el texto de un elemento conservando los saltos de línea internos.
// Los <br> de Google Docs se convierten en '\n', y los hijos block-level
// también introducen un salto entre ellos.
function extractText(el) {
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue || '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === 'BR') { parts.push('\n'); return; }
    for (const child of node.childNodes) walk(child);
  };
  walk(el);
  return parts.join('');
}

function parseDoc(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nodes = Array.from(doc.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p'));
  const songs = [];
  const sections = [];
  let curSong = null;
  let currentSection = '';

  for (const el of nodes) {
    const rawWithBreaks = clean(extractText(el));
    const raw = rawWithBreaks.trim();
    if (!raw) continue;

    if (el.tagName === 'H1') {
      if (/índice|indice/i.test(raw)) continue;
      currentSection = raw;
      if (!sections.includes(currentSection)) sections.push(currentSection);
      continue;
    }

    if (/^H[2-6]$/.test(el.tagName) || raw.startsWith('### ')) {
      if (curSong) songs.push(curSong);
      curSong = { title: raw.replace(/^###\s*/, ''), text: '', section: currentSection };
    } else if (curSong) {
      // Si el párrafo contiene saltos de línea internos (multi-línea),
      // preservamos cada línea como una entrada separada en el texto.
      curSong.text += (curSong.text ? '\n' : '') + rawWithBreaks.replace(/\n+/g, '\n');
    }
  }
  if (curSong) songs.push(curSong);

  return { songs, sections };
}

/* -------------------------------------------------------------------------
 * Render de la lista lateral y filtros
 * ------------------------------------------------------------------------- */

function fillSections() {
  if (!dom.sectionSel) return;
  // limpiar opciones excepto la primera
  while (dom.sectionSel.children.length > 1) {
    dom.sectionSel.removeChild(dom.sectionSel.lastChild);
  }
  for (const sec of state.sections) {
    const opt = document.createElement('option');
    opt.value = sec;
    opt.textContent = sec;
    dom.sectionSel.appendChild(opt);
  }
}

function renderSideList() {
  if (!dom.sideUl) return;
  const filter = (dom.search?.value || '').trim().toLowerCase();
  const sectionFilter = dom.sectionSel?.value || '';
  const matches = state.songs.filter(s =>
    (sectionFilter === '' || s.section === sectionFilter) &&
    s.title.toLowerCase().includes(filter)
  );

  const frag = document.createDocumentFragment();
  matches.forEach((song, i) => {
    const li = document.createElement('li');
    li.className = 'song-item';
    li.style.setProperty('--i', String(i));
    const titleSpan = document.createElement('span');
    titleSpan.className = 'song-item__title';
    titleSpan.textContent = song.title;
    li.appendChild(titleSpan);
    if (song.section) {
      const sectionSpan = document.createElement('span');
      sectionSpan.className = 'song-item__section';
      sectionSpan.textContent = song.section;
      li.appendChild(sectionSpan);
    }
    li.addEventListener('click', () => loadSong(state.songs.indexOf(song)));
    frag.appendChild(li);
  });

  dom.sideUl.replaceChildren(frag);

  if (dom.empty) {
    dom.empty.hidden = matches.length > 0;
  }

  highlightActive(state.currentIdx);
}

function renderSuggestions() {
  if (!dom.suggestDL) return;
  const term = (dom.search?.value || '').trim().toLowerCase();
  if (term.length === 0) {
    dom.suggestDL.replaceChildren();
    return;
  }
  const matches = state.songs
    .filter(s => s.title.toLowerCase().includes(term))
    .slice(0, 20);
  const frag = document.createDocumentFragment();
  for (const song of matches) {
    const opt = document.createElement('option');
    opt.value = song.title;
    frag.appendChild(opt);
  }
  dom.suggestDL.replaceChildren(frag);
}

function highlightActive(idx) {
  state.currentIdx = idx;
  if (!dom.sideUl) return;
  const targetTitle = state.songs[idx]?.title;
  for (const li of dom.sideUl.children) {
    const t = li.querySelector('.song-item__title')?.textContent;
    li.classList.toggle('is-active', t === targetTitle);
  }
}

function loadSong(idx) {
  if (idx < 0 || idx >= state.songs.length) return;
  const song = state.songs[idx];
  const fullText = `${song.title}\n${song.text}`.trim();
  if (dom.input) dom.input.value = fullText;
  if (typeof window.invalidateChordCache === 'function') {
    window.invalidateChordCache();
  }
  highlightActive(idx);
  if (typeof window.resetShiftCh === 'function') {
    window.resetShiftCh();
  }
  // cerrar bottom sheet en móvil
  document.body.classList.remove('panel-open');
}

/* -------------------------------------------------------------------------
 * Indicadores de estado
 * ------------------------------------------------------------------------- */

function setStatus(message, kind) {
  if (!dom.status) return;
  dom.status.textContent = message || '';
  dom.status.dataset.kind = kind || '';
  dom.status.hidden = !message;
}

function setLoading(isLoading) {
  document.body.classList.toggle('is-loading', !!isLoading);
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} d`;
}

/* -------------------------------------------------------------------------
 * Flujo principal
 * ------------------------------------------------------------------------- */

function applyData(data) {
  state.songs = data.songs;
  state.sections = data.sections;
  state.loadedAt = data.fetchedAt || Date.now();
  fillSections();
  renderSideList();
  renderSuggestions();
}

async function refreshFromNetwork({ silent } = { silent: false }) {
  if (!silent) setLoading(true);
  try {
    const html = await fetchDoc(DOC_URL);
    const { songs, sections } = parseDoc(html);
    if (songs.length === 0) throw new Error('Documento vacío o sin canciones');

    const payload = { songs, sections, fetchedAt: Date.now() };
    writeCache(payload);

    // si cambió respecto al cache visible, swap
    const same = state.songs.length === songs.length &&
      state.songs.every((s, i) => s.title === songs[i].title);
    if (!same) {
      applyData(payload);
      if (silent) {
        setStatus(`Cancionero actualizado · ${relativeTime(payload.fetchedAt)}`, 'info');
      }
    } else if (silent) {
      setStatus(`Cancionero al día · actualizado ${relativeTime(payload.fetchedAt)}`, 'info');
    }

    if (!silent) {
      setStatus(`Cargado · ${songs.length} canciones · ${relativeTime(payload.fetchedAt)}`, 'info');
    }
  } catch (err) {
    if (!silent) {
      setStatus('No se pudo descargar el cancionero. Comprueba tu conexión.', 'error');
    }
    // si silent, no molestamos al usuario
  } finally {
    setLoading(false);
  }
}

function init() {
  dom.sideUl = $('sideList');
  dom.sectionSel = $('sectionSelect');
  dom.search = $('songSearch');
  dom.suggestDL = $('searchSuggestions');
  dom.input = $('song-input');
  dom.status = $('songbookStatus');
  dom.empty = $('songbookEmpty');
  dom.refreshBtn = $('refreshSongbook');
  dom.toggleBtn = $('togglePanel');

  if (dom.search) {
    dom.search.addEventListener('input', () => {
      renderSuggestions();
      renderSideList();
    });
    dom.search.addEventListener('change', () => {
      const idx = state.songs.findIndex(s =>
        s.title.toLowerCase() === dom.search.value.trim().toLowerCase()
      );
      if (idx !== -1) loadSong(idx);
    });
  }
  if (dom.sectionSel) {
    dom.sectionSel.addEventListener('change', renderSideList);
  }
  if (dom.refreshBtn) {
    dom.refreshBtn.addEventListener('click', () => {
      setStatus('Actualizando…', 'info');
      refreshFromNetwork({ silent: false });
    });
  }
  if (dom.toggleBtn) {
    dom.toggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('panel-open');
    });
  }

  // 1. Pintar caché si existe
  const cache = readCache();
  if (cache && cache.songs?.length) {
    applyData(cache);
    setStatus(`Cargado desde caché · ${relativeTime(cache.fetchedAt)}`, 'info');
  } else {
    setStatus('Cargando cancionero…', 'info');
  }

  // 2. Refrescar de red
  const triggerFetch = () => {
    const silent = !!cache && isFresh(cache);
    refreshFromNetwork({ silent });
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(triggerFetch, { timeout: 1500 });
  } else {
    setTimeout(triggerFetch, 50);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
