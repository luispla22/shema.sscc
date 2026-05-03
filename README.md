# SHEMÁ SSCC

Web del coro Shemá SSCC con cancionero y trasponedor de acordes.

Las canciones se cargan automáticamente desde un Google Doc publicado y el
motor de transposición permite cambiar la tonalidad manteniendo la coherencia
armónica de la canción. Soporta notación española (Do, Re, Mi…) y americana
(C, D, E…).

## Funcionalidades

- **Cancionero en vivo:** carga las canciones del Google Doc oficial con caché
  local (stale-while-revalidate) — instantáneo en visitas repetidas.
- **Búsqueda y filtros:** por título o por sección.
- **Trasponedor coherente:** detecta la tonalidad de la canción y elige
  enarmónicos consistentes (sostenidos o bemoles según la armadura).
- **Modo libre:** página separada para pegar tu propia canción.
- **Acordes complejos:** soporta `Cmaj7`, `Dm7b5`, `G7sus4`, slash chords
  (`Sol/Si`), notación mixta, etc.
- **Diseño responsive:** sidebar colapsable en móvil, controles fijos al
  alcance del pulgar.

## Estructura del proyecto

```
index.html         # Cancionero principal
index2.html        # Modo libre (pega tu canción)
styles.css         # Sistema de diseño "Misal moderno"
script.js          # Motor de transposición de acordes
songbook.js        # Cargador del Google Doc con caché
images/
  favicon.jpg      # Favicon
  shema.jpg        # Logo del coro (apple-touch-icon y marca del header)
```

## Uso

### Cancionero ([index.html](index.html))

1. Abre la página. La primera vez tarda unos segundos en descargar el
   cancionero; después es prácticamente inmediato (caché).
2. Busca por título o filtra por sección.
3. Selecciona una canción de la lista.
4. Usa **+** y **−** para transponer; **Reset** vuelve a la tonalidad
   original.
5. Cambia el cifrado entre Español y Americano cuando lo necesites.
6. Botón **Actualizar** del lateral fuerza un refresh desde Google Docs.

### Modo libre ([index2.html](index2.html))

1. Pega tu canción con acordes en el área de texto.
2. Aplica los mismos controles de transposición y cifrado.

## Detalles del motor de transposición

El motor en [script.js](script.js):

- Parsea acordes con expresión regular: nota + alteración + cualidad
  (`m`, `maj`, `dim`, `aug`, `sus`) + extensión + bajo opcional.
- Detecta la tonalidad de la canción y, al transponer, escoge la familia de
  enarmónicos consistente (sostenidos o bemoles según la armadura nueva).
- Distingue líneas de acordes de líneas de letra mediante varias señales
  combinadas (proporción, densidad de espacios, mayúsculas, modificadores y
  stop-list de palabras españolas comunes que coinciden con notas: `la`, `el`,
  `mi`, `do`, `si`, `fa`, `re`).
- Mantiene la posición original de cada acorde sobre la sílaba aunque cambie
  de longitud al transponer.
- Memoiza el parseo: una sola pasada por canción, transposiciones posteriores
  recalculan sólo la salida.

## Estrategia de carga

[songbook.js](songbook.js) implementa **stale-while-revalidate**:

1. Si hay caché en `localStorage` con menos de 6 h, se renderiza de inmediato.
2. En paralelo se hace fetch desde Google Docs (intentando primero conexión
   directa con CORS, cayendo al proxy `corsproxy.io` o `allorigins.win` si
   falla).
3. Si los datos cambiaron, se intercambia silenciosamente.
4. El usuario puede forzar refresh manual con el botón **Actualizar**.

## Despliegue

Es un sitio estático puro (HTML/CSS/JS, sin frameworks ni build step).
Cualquier hosting estático sirve: GitHub Pages, Netlify, Vercel, Cloudflare
Pages, S3 + CloudFront, o un simple `python3 -m http.server`.

## Créditos

Motor original de transposición: A. González SJ — AMDG.
Reescrito y rediseñado para el coro Shemá SSCC.
