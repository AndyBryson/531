# Weights

A 5/3/1 (Wendler) training-max calculator. Single self-contained HTML file, no build step, no dependencies at runtime.

Independent build — not affiliated with Jim Wendler or any 5/3/1 app.

## Use it

Open `index.html` in a browser. State persists in `localStorage`.

## Features

- Training max from 1RM, direct TM entry, or a rep-set (Epley) input
- Templates: Standard, Boring But Big, First Set Last, Pyramid, 5's PRO, GVT, Triumvirate, 5/3/1 for Beginners
- Plate-loading calculator: sequences a session's sets to minimise plate changes between sets (not just heaviest-first), respects a limited per-side plate inventory, flags inexact loads as "closest available"
- Custom accessory exercises per lift, with optional weight and plate loading
- 4-day or 3-day/week scheduling with reorderable lift order
- Print layout: one week per page, two (or three, for a 3-day week) lifts per row, checkbox column for tracking sets on paper

### 5/3/1 for Beginners

Fixed 3-day split, independent of the days/week and lift-order settings:

- Day 1: Squat (full 5/3/1 wave) + Bench Press practice sets (fixed 3×5 @ 55/65/75% of Bench's own TM)
- Day 2: Deadlift and Overhead Press, both full waves
- Day 3: Bench Press (full wave) + Squat practice sets

## Development

Tests run the page in [jsdom](https://github.com/jsdom/jsdom) and exercise it headlessly (no browser required):

```
npm install
npm test
```
