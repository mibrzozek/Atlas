# Animated text in videos: plan

Write a sentence, and the video shows it the way film titles and Reels captions do: word by word, at a
speed that can be set, appearing in a style that can be chosen. Not started; this is the plan
(2026-10-21). It builds on the video editor in `docs/workspace-video-plan.md`.

## How it works for the user

**A Text lane** on the timeline, under Motion. Its **+** puts a text block at the playhead, and the
Selected tab opens on it with the cursor in a box to type the sentence. A text block is like a motion
block: dragged to move it in time, its edges to make it longer or shorter, snapping to the beats.

**The words appear one at a time.** How, in a few choices, each one click:

- **Build up**: words are added until the sentence is whole (film titles, quotes).
- **One at a time**: each word replaces the one before, large in the middle (Reels and TikTok style).
- **Line by line**: a line at a time, for longer text.
- **Letter by letter**: a typewriter.

**The speed**, one of three ways:

- **Words a second** (a slider, e.g. 1 to 8), the rest of the block holding the whole sentence;
- **Fill the block**: the words spread over the block's length, so stretching the block slows them;
- **On the beat**: a word on every beat of the music (or every second beat), which is what makes it feel
  edited.

**How a word appears** (the entrance of each word), a row of small moving previews to pick from:

| Style | What it does |
|---|---|
| Fade | soft fade in |
| Rise | comes up a little while fading in |
| Pop | grows in with a small bounce |
| Slide | comes in from the side |
| Blur | goes from blurred to sharp (cinematic) |
| Drop | falls into place |
| Stamp | big to normal, hard, like a stamp |
| Highlight | the whole sentence is there dimmed, each word lights up in turn (karaoke) |
| Typewriter | letters appear one by one with a cursor |

Each has a strength and a duration per word, with the same one-click easing as the camera.

**How it goes away** at the end of the block: all at once (fade, or a cut), word by word in the same
style backwards, or it stays until the next text block replaces it.

**How it looks**, with presets to start from and everything adjustable after:

- **Presets:** *Film title* (serif, spaced letters, centred, fade), *Reel caption* (heavy sans, white
  with a dark outline, one word at a time, pop), *Subtitle* (lower third, smaller, build up),
  *Typewriter* (mono, letter by letter), *Quote* (italic serif, line by line, blur).
- **Font** (a short list of fonts that work well on video; see the open questions), weight, size,
  letter spacing, alignment, colour.
- **Legibility:** an outline, a soft shadow, or a box behind the text (with its colour, roundness and
  padding), so white text reads over light photos.
- **Where:** placed in the frame, not on the workspace, so it stays put while the camera moves. Presets
  (top, middle, lower third, bottom), and with a text block selected its box shows in the viewfinder,
  to be dragged anywhere and its width set by its edge. Long sentences wrap to that width.

**Keywords stand out:** a word put between asterisks in the box (`a *golden* evening`) gets an accent
colour or a larger size, the way Reels captions highlight one word.

## How it is made

Following what the video already does (`common/` for the maths, with tests; one `stateAt`; the
preview and the saved file drawing the same way):

1. **Model** (`common/video-text.ts`, tested): a `TextBlock` on the video (start, length, the sentence,
   how it reveals, the speed, the entrance and exit, its look and its place in the frame as fractions of
   the frame, so it is the same in every format).
   - `wordsOf(text)`: the words, with the asterisk keywords marked.
   - `layoutText(block, frameSize, measure)`: lines and the place of every word, wrapped to the box;
     `measure` is passed in (the page's text measuring), so tests can pass their own, as the workspace
     already does for its texts.
   - `textAt(block, time, beats)`: for every word (or letter) whether it is seen, and how far into its
     entrance or exit it is (opacity, offset, scale, blur, highlight).
2. **Drawing:** `drawFrame` draws the text blocks last, over everything, in pixels of the frame (not of
   the workspace), through `WorkspacePainter` with an outline, shadow and box. Blur is the canvas
   `filter` (supported in this Chromium); each word is drawn on its own, so a word's entrance never moves
   the others.
3. **The lane and its settings:** a Text lane in `VideoTimeline`, and its settings in `VideoSettings`:
   the sentence box, the presets as a row of small live previews (each a tiny canvas drawing a looping
   sample with `textAt`), and the controls above.
4. **Placing it:** with a text block selected, its box is drawn in the viewfinder (in pixels of the
   screen, like the frame), dragged to move and sized by its edge; a click on the playhead shows the
   sentence as it is at that moment.
5. **Saving:** nothing new: the frames are drawn by `drawFrame`.

Fonts are drawn with the canvas, so the font has to be loaded before the first frame of a saved video is
drawn (`document.fonts.load`), or the first frames would use a fallback.

## Steps

1. **The model and drawing**: words, layout, `textAt` with build up and one at a time, fade, rise and pop,
   words a second and fill the block. With tests.
2. **The Text lane** with its block, and the settings with the sentence box, speed and style.
3. **The look**: presets, font, outline, shadow, box, keywords between asterisks.
4. **Placing it in the viewfinder** by dragging.
5. **On the beat**, line by line, letter by letter, blur, slide, drop, stamp, highlight, typewriter, the
   exits.

Each step is usable on its own; after step 2 a sentence can already appear word by word in a saved video.

## Open questions

- **Fonts:** the fonts on the computer differ between Windows, Mac and Linux, so a video would look
  different on another computer. Bundling a few free fonts (Open Font Licence: for example Inter, Bebas
  Neue, Playfair Display, JetBrains Mono, Caveat) makes it the same everywhere, at a few hundred kB each.
  Recommended; it needs your OK as new files in the app.
- **Text on the workspace too?** The plan puts captions in the frame, fixed while the camera moves. Text
  can already be put on the workspace itself and given motions; should those texts also get the
  word-by-word reveal, so they can move with the photos?
- **Several sentences in a row:** one block per sentence (each placed and timed on its own), or one block
  where each line of the box becomes the next sentence, spread over the block? The plan starts with one
  sentence per block; the second is easy to add.
