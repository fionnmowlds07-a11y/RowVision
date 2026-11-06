# RowVision design system

Chosen by the owner over two rounds of mock-ups. `apps/preview` keeps its older look and is not the reference for `apps/web`.

## World

A club boat on a training morning: deep green kit, white pages, and a bright green that says "look here". The energy of a training app, with the honesty of a results sheet. Footage sits in a near-black frame, so it is the strongest thing on the page.

This is an Operate surface. Familiar controls and quick scanning come first.

## Colour

The base colours are shades of green with white and black, the UL rowing club colours. Colours only, with no crest or club name.

| Token | Value | Use |
|---|---|---|
| `--ground` | `#0a5c3a` | Page ground. Athletes can change this |
| `--on-ground` | `#ffffff` | Text on the ground |
| `--on-ground-soft` | `#d3eee0` | Secondary text on the ground |
| `--panel` | `#ffffff` | Cards and panels |
| `--ink` | `#0a2a1c` | Text on panels |
| `--ink-soft` | `#44604f` | Secondary text on panels |
| `--quiet` | `#e3f3ea` | Fields, quiet buttons, lanes |
| `--stage` | `#06140d` | Footage frame and viewer |
| `--on-stage` | `#ffffff` | Text on the stage |
| `--highlight` | `#4be38a` | Primary actions and the main score. Athletes can change this |
| `--on-highlight` | `#06140d` | Text on the highlight |
| `--link` | `#0a6b44` | Links on panels, target bands, catch markers |
| `--caution-bg`, `--caution` | `#fff1d6`, `#6b4700` | Cautions |
| `--danger` | `#b3261e` | Poor rating and errors, on panels |

The highlight is a fill, never text on a panel, as bright green on white is unreadable. Colour never carries meaning alone: catches are round markers and finishes are square, and every rating has its word beside it.

### Your own colours

Athletes can change the ground and the highlight. Panels, the stage and caution colours stay fixed, so the footage and warnings look the same for everyone. Text on a chosen colour switches between black and white automatically, whichever reads better.

| Preset | Ground | Highlight |
|---|---|---|
| Black | `#070b09` | `#35d07f` |
| Forest | `#0a3d27` | `#4be38a` |
| Deep green (default) | `#0a5c3a` | `#4be38a` |
| Mid green | `#127049` | `#b6f2c9` |
| Pale green | `#dff1e6` | `#0b7a4b` |

## Type

Bricolage Grotesque (800) for headings, scores and big numbers. DM Sans (400, 500, 700) for everything else. Both self-hosted. Numbers use tabular figures.

Scale: 13, 14, 16, 19, 24, 32px, plus 44 and 72px for scores and 68px for the sign-in headline. Headings use -0.02em tracking.

## Shape and depth

Panels use a 26px radius, buttons 18px, fields 16px, and the footage frame 26px. Generous soft shadows on phones and laptop frames only. No nested panels, no gradients on text, no coloured side borders.

## Signature

Two things repeat.

**The main score tile:** a block of highlight with the number very large. There is one per screen at most.

**Chart lines:** fine contour lines from a river chart behind sign-in, used nowhere else.

Each measure uses a lane: a rounded track with the target band and a marker for your value.

## Layout

Each screen is designed for both sizes.

| Screen | Phone | Laptop |
|---|---|---|
| Sign-in | Headline over chart lines, form card at the bottom | Headline and form card on the left over chart lines |
| Your clips | Stacked cards, latest in highlight | Dark side column with navigation and Add a video, cards in two columns |
| Add a video | Frame, upload card, setup card, Analyse | Full-width frame, with setup in a row of fields underneath |
| Results | Score and accuracy tiles, Work on next, measures, Open video | Video left with stroke lane and controls, tiles and measures right |
| Viewer | Dark screen, frame, stroke lane, three angle tiles, step controls. Sideways gives the biggest picture | Dark screen, frame, angle tiles at the side, stroke lane and all controls underneath |

Touch targets are at least 44px.

## Motion

150 to 200ms on state changes only, and none when reduced motion is requested.

## Icons

Inline SVG, 2.5px rounded stroke, drawn in one set.
