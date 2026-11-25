# RowVision design system

Chosen by the owner over two rounds of mock-ups. `apps/preview` keeps its older look and is not the reference for `apps/web`.

## World

A stroke coach display at first light: a black screen, bright green figures and nothing wasted. It has the energy of a training app and the honesty of an instrument. Footage sits in a pure black frame, so it is the strongest thing on the page.

This is an Operate surface. Familiar controls and quick scanning come first.

## Colour

The base colours are shades of green with white and black, the UL rowing club colours. Colours only, with no crest or club name.

| Token | Value | Use |
|---|---|---|
| `--ground` | `#070b09` | Page ground. Athletes can change this |
| `--on-ground` | `#ffffff` | Text on the ground |
| `--on-ground-soft` | `#b5c7bc` | Secondary text on the ground |
| `--panel` | `#121a15` | Cards, panels and tiles |
| `--ink` | `#ffffff` | Text on panels |
| `--ink-soft` | `#a9bdb0` | Secondary text on panels |
| `--quiet` | `#1f2b24` | Fields, quiet buttons, lanes |
| `--stage` | `#000000` | Footage frame and viewer |
| `--on-stage` | `#ffffff` | Text on the stage |
| `--highlight` | `#35d07f` | Primary actions and the main score. Athletes can change this |
| `--on-highlight` | `#04140b` | Text on the highlight |
| `--link` | `#7fe3ad` | Links, target bands, catch markers |
| `--caution-bg`, `--caution` | `#fff1d6`, `#6b4700` | Cautions |
| `--danger` | `#ff8f85` | Poor rating and errors |

Colour never carries meaning alone: catches are round markers and finishes are square, and every rating has its word beside it.

### Your own colours

Athletes can change the ground and the highlight. Panels, the stage and caution colours stay fixed, so the footage and warnings look the same for everyone. Text on a chosen colour switches between black and white automatically, whichever reads better.

| Preset | Ground | Highlight |
|---|---|---|
| Black (default) | `#070b09` | `#35d07f` |
| Forest | `#0a3d27` | `#4be38a` |
| Deep green | `#0a5c3a` | `#4be38a` |
| Mid green | `#127049` | `#b6f2c9` |
| Pale green | `#dff1e6` | `#0b7a4b` |

## Type

Bricolage Grotesque (800) for headings, scores and big numbers. DM Sans (400, 500, 700) for everything else. Both self-hosted. Numbers use tabular figures.

Scale: 13, 14, 16, 19, 24, 32px, plus 44 and 72px for scores and 68px for the sign-in headline. Headings use -0.02em tracking.

## Shape and depth

Panels and the footage frame use a 14px radius, buttons 10px, and fields and tiles 8px. No nested panels, no gradients on text, no coloured side borders.

## Signature

**The stats strip:** a row of tiles with very large numbers, like a stroke coach display. The main score is the one tile filled with the highlight.

**Chart lines:** fine contour lines from a river chart behind sign-in, used nowhere else.

Each measure uses a lane: a rounded track with the target band and a marker for your value.

## Layout

Each screen is designed for both sizes.

| Screen | Phone | Laptop |
|---|---|---|
| Sign-in | Headline over chart lines, form card at the bottom | Headline and form card on the left over chart lines |
| Your clips | Stacked cards, latest in highlight | Top bar with Add a video, cards in two columns |
| Add a video | Frame, upload card, setup card, Analyse | Full-width frame, with setup in a row of fields underneath |
| Results | Score and accuracy tiles, Work on next, measures, Open video | Stats strip across the top, video left with stroke lane and controls, Work on next and measures right |
| Viewer | Black screen, frame, stroke lane, three angle tiles, step controls. Sideways gives the biggest picture | Black screen, frame, angle tiles at the side, stroke lane and all controls underneath |

Touch targets are at least 44px.

## Motion

150 to 200ms on state changes only, and none when reduced motion is requested.

## Icons

Inline SVG, 2.5px rounded stroke, drawn in one set.

## Marketing site

`apps/site` is a Persuade surface and has its own look, chosen by the owner from mock-ups on 2026-11-13. It shares the app's type and highlight green, and nothing else is assumed to carry over.

**World: black water.** A near-black ground (`#020403`) with slow bands of light and fine chart lines moving across it like water before sunrise. Real phone footage is the only colour on the page, and green (`#4be38a`) is kept for what RowVision draws: joints, angle arcs, chart lines and the primary action. The ground goes fully black behind the data stages.

**The film.** The home page is one pinned stage driven by scroll. Footage sits in a phone-shaped frame, pushes in to fill the window, is picked apart into joints and angles, and tips back into depth. Scrolling is always the browser's own. Reduced motion and no-script visitors get the same words as an ordinary page.

**Type.** Bricolage Grotesque 800 for headings, up to 210px for the single words Legs, Back and Arms. DM Sans for everything else.

**The other pages.** Eight shorter pages sit beside the film: How it works, What it measures, Accuracy, Filming, Boats and crews, Reports, Your video and Download. They share one header and footer, and the same water moves behind them at the film's opening colours.

- **The header.** Home, How it works, Reports and Download. Everything else is under More. Reports stays in view on a phone, as it is a main feature (owner, 2026-11-25).
- **Few words.** A page shows the thing and says one short line about it.
- **The mark.** The app icon sits beside the name in the header and footer. It is never redrawn or recoloured.
- **The bench.** A black stage with a drawing on the left, its readings in large green figures on the right and its controls underneath. Used for the stroke explorer and the camera dial. Every bench has a slider as well as dragging, so it works from the keyboard.
- **Rows.** A term on the left and what it means on the right, ruled between. Used where a page lists measures or facts. No cards.
- **Papers.** Printed pages are shown white on the water, the only white ground on the site. A chart cut from a page sits on its own white strip beside the question it answers.
- **Camera ring.** Green for side-on, amber for corrected, red for end-on. Each state also has its name beside it, so colour never carries the meaning alone.
- **Messages.** Words the app really says are shown in the app's caution colours.
- Pages cross-fade into each other where the browser can, and not at all under reduced motion.

**Rules.**
- Every number on screen is measured from the clip on screen, or comes from the measuring code's own limits. No invented scores, results or quotes. The one exception is the sample statistics sheet on Reports, whose crew is made up and labelled so on the page and on the sheet (owner, 2026-11-25).
- Catches are round marks and finishes are square, as in the app.
- Cautions use the app's caution colours (`#fff1d6` on `#6b4700`).
- Footage never goes in the repository, and no clip goes public without the owner's say.
