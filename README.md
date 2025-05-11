# SHEMÁ SSCC WEB PAGE

Web application developed for the Shemá SSCC choir, featuring a powerful chord transposition tool. The application pulls songs from an official songbook stored in a Google Document and allows users to easily transpose chords to different musical keys.

## Features

- **Song Library**: Automatically loads songs from an official Google Doc songbook
- **Chord Transposition**: Change the key of any song with easy +/- controls
- **Song Search**: Quick search functionality to find songs by title
- **Section Filtering**: Filter songs by section/category
- **Notation Options**: Support for both Spanish (Do, Re, Mi) and American (C, D, E) notation systems
- **Custom Song Mode**: Allows users to input and transpose their own songs not in the songbook
- **Mobile Responsive**: Optimized layout for both desktop and mobile devices
- **Quick Access Links**: Direct links to Spotify playlist and calendar

## How It Works

The application uses JavaScript to parse and identify chord patterns in text. When a song is loaded or input by the user, the app detects lines containing chords and allows the user to transpose them up or down by semitones while preserving the lyrics and formatting.

## File Structure

```
├── index.html      # Main page with songbook integration
├── index2.html     # Custom song transposition page
├── script.js       # Core transposition logic
├── styles.css      # Styling for index2.html
├── README.md       # Project documentation
└── images/
    ├── calendar.png
    ├── favicon.jpg
    ├── shema.jpg
    └── spoty.png
```

## Usage

### Songbook Mode (Main Page)
1. Open [`index.html`](index.html)
2. Wait for songs to load from the Google Document (up to 30 seconds)
3. Use the search box or section dropdown to find a song
4. Select a song from the side panel to load it
5. Use the +/- buttons to transpose chords as needed
6. Choose between Spanish or American notation systems

### Custom Song Mode
1. Open [`index2.html`](index2.html)
2. Paste or type your song with chords into the textarea
3. Use the +/- buttons to transpose the chords
4. Choose between Spanish or American notation systems

## Implementation Details

The chord transposition engine in [`script.js`](script.js) uses a sophisticated algorithm that:
- Detects chord lines vs. lyric lines
- Parses musical notation in both Spanish and American systems
- Preserves chord positioning relative to lyrics
- Handles various chord modifiers (7, m, dim, etc.)

_Note: CSS is integrated in HTML files. Not the best practice but it works for now._

## Future Improvements

While the transposition tool is already well-developed, there are plans to:
- Improve mobile responsiveness
- Extract CSS from HTML into separate files for better maintainability
- Add print functionality for sheet music
- Implement offline functionality with local storage
