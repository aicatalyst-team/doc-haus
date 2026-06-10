# Demo assets

`logo.png` — the (fictional) Aldgate & Crane LLP emblem embedded in the demo
letter of engagement (`src/seed.ts`). A serif "A&C" monogram in a gold-ruled
navy square. It is a committed static asset so seeding has no image-processing
dependency.

To redraw it, rasterise this SVG to a 280×280 PNG (any SVG→PNG tool works, e.g.
a one-off `bunx sharp-cli` or an online converter — no runtime dependency is
added):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 280 280">
  <rect width="280" height="280" fill="#1C2B3A"/>
  <rect x="16" y="16" width="248" height="248" fill="none" stroke="#C9A24B" stroke-width="3"/>
  <text x="140" y="165" text-anchor="middle" fill="#F4F1EA"
    font-family="Georgia, serif" font-size="118" font-weight="600" letter-spacing="-4">A&amp;C</text>
  <text x="140" y="232" text-anchor="middle" fill="#C9A24B"
    font-family="Georgia, serif" font-size="20" letter-spacing="8">EST. 1971</text>
</svg>
```
