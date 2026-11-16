# Azalea design direction

Direction as stated by the project owner:

- Redo the UI completely.
- Super clean. It must not look like AI slop.
- Keep customization: the 12 themes, font size, icon packs and custom CSS stay working.

## How this is applied

- Every color comes from the theme tokens in `apps/desktop/src/styles/globals.css`. No hard-coded palette, so all themes keep working.
- One radius scale, set once in `@theme` (small controls, containers). Nothing is pill-shaped except true pills.
- Flat surfaces: borders separate things, shadows are not used for decoration, no glow, no gradients, no glass.
- The accent marks the primary action and the active state only.
- Labels are sentence case. No uppercase letter-spaced labels.
- Every number and status shown comes from real data.
