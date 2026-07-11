# Fame brand guidelines (for anything you build)

Source of truth: `fame-brandguidelines.pdf` (held by Tom). This file captures
the parts that matter for building UI, so every screen stays on-brand. When you
add colour or type to Crew Shoot Status (or any Fame surface), use these tokens.

The tokens below are already defined in `app/globals.css` `:root`. **Prefer the
`var(--token)` over a raw hex** so a future palette tweak is one edit.

## Font

**Figtree** - Regular, Italic, Bold. Don't introduce another typeface; the
only acceptable fallback is the system sans stack.

## Colour

### Primary
| Name | Hex | Token | Use |
|---|---|---|---|
| Pink | `#ff467c` | `--pink` | Brand accent - buttons, active nav, links, primary chart series |
| Dark | `#292a25` | `--dark` | Body text (warm near-black) |
| Cream | `#f8f1eb` | `--bg` | Page background |

### Secondary
| Name | Hex | Token |
|---|---|---|
| Mint | `#cee8e0` | `--mint` |
| Light pink | `#f9d2e3` | `--pink-light` |
| Periwinkle | `#7778b8` | `--periwinkle` |
| Orchid | `#b373b0` | `--orchid` |
| Green | `#71be46` | `--green` |
| Yellow | `#f6cd67` | `--yellow` |

### Derived state tokens (already built from the palette)
- Success: `--success-bg` (mint) / `--success-fg` / `--success-accent` (green)
- Warning: `--warning-bg` / `--warning-fg` / `--warning-line` (yellow family)
- Review / "changes requested": `--review-bg` / `--review-fg` / `--review-accent`
  (amber - intentionally outside the brand palette; orchid and periwinkle were
  both tried live and read wrong for this state, see the comment in
  `app/globals.css`)
- `--pink-hover` for pink button hovers

### Functional neutrals (intentionally NOT brand colours - fine to use)
`--card` (#fff), `--border`, `--text` (=dark), `--text-muted` (#6b7280),
`--marker-muted`. And `--red` (#c0392b) **for genuine errors / destructive
actions only - the brand has no decorative red**.

## Hard rules

- **No blue.** It is not in the palette. Never use `#2563eb` / `#3b82f6` /
  any blue for links, accents, or chart series. Use `--pink` (primary) and
  `--periwinkle` (secondary series) instead.
- **No decorative red.** Red = errors/destructive only, via `--red`.
- **Multi-series charts:** pink → periwinkle → yellow/green → orchid, in that
  order, so every chart tells the same colour story.
- **Corner radius:** `--radius` (12px) for cards and inputs.

If you need a colour that isn't here, it's probably wrong - reach for the
nearest brand token first.
