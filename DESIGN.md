# RowVision design system

## World

A regatta course on a bright morning: pale water, white pontoons, deep navy ink, and orange buoys marking the lane. Bright, clean and friendly, with round forms that have a job to do. The footage sits in a deep navy frame so it is the strongest thing on the page.

This is an Operate surface. Familiar controls and quick scanning come first.

## Colour

| Token | Value | Use |
|---|---|---|
| `--water` | `#eaf6fb` | Page ground |
| `--pontoon` | `#ffffff` | Panels |
| `--shallow` | `#d6edf6` | Quiet fills, lanes, hover |
| `--ink` | `#0e2a3b` | Text |
| `--ink-soft` | `#476272` | Secondary text |
| `--stage` | `#0b1e2b` | Footage frame |
| `--buoy` | `#c2410c` | Primary actions, current selection, your value |
| `--lane` | `#0b6e99` | Links, focus, target bands |
| `--catch` | `#0a7d50` | Catch markers |
| `--finish` | `#c2410c` | Finish markers |
| `--caution-bg`, `--caution` | `#fff1d6`, `#6b4700` | Cautions |
| `--danger` | `#b3261e` | Poor rating, errors |

Buoy orange is the only strong accent. Colour never carries meaning alone.

## Type

Rubik, self-hosted, one family. Fixed scale: 13, 14, 16, 19, 24, 32px. Numbers use tabular figures.

## Shape and depth

Pills for controls, 20px radius for panels, 24px for the footage frame. Soft shadows with an offset. No nested panels, no gradients on text, no coloured side borders.

## Signature

The lane: a rounded track with buoys on it. The stroke timeline places a buoy at each catch and finish. Each measure uses a small lane with the target band and a buoy for your value.

## Layout

Video left, scores right. A drag handle and a size control resize the video. Past 76% of the width, or on narrow screens, scores move underneath.

## Motion

150 to 200ms on state changes only, and none when reduced motion is requested.

## Icons

Inline SVG, 2px rounded stroke, drawn in one set.
