# İnecek Var brand assets

| File | Usage |
| --- | --- |
| `logo/inecekvar-wordmark.svg` | İNECEK VAR minibus sign with custom letter shapes. |
| `logo/inecekvar-mark.svg` | Badge with a top hanger, stop ring, two wheels and a lower stripe. |
| `logo/inecekvar-mark-mono.svg` | Single color using `currentColor`; the ring, body symbol and stripe are transparent cutouts. |
| `icons/app-icon.svg` | Sign on a navy background; horizontal padding is 18%. |
| `icons/app-icon-foreground.svg` | Transparent adaptive foreground on a 108-unit canvas. |
| `icons/app-icon-background.svg` | Solid navy background on a 108-unit canvas. |
| `icons/favicon.svg` | Simplified hanger, ring, wheels and stripe for 32 × 32. |
| `icons/maskable-icon.svg` | Navy background; artwork stays inside the central safe circle with an 80% diameter. |

## Colors

| Color | Code | Usage |
| --- | --- | --- |
| Minibus yellow | `#F2B705` | Sign and top hanger |
| Navy | `#14213D` | Background, letters, stop ring and wheels |
| Turquoise | `#2AB7CA` | Lower stripe of the minibus sign |

## Structure and dimensions

The badge's top hanger and two lower wheels form the silhouette of a minibus/stop sign. The dot of the letter İ is a navy stop ring. The turquoise stripe is a shared lower-edge detail in all color variants. In the monochrome variant, the stripe remains a transparent cutout.

The wordmark sign body measures 770 × 224 units. Letter bodies are 70 units high; the lettering height including the dot ring is 109 units. Inner spacing is 50 units on the left, 53 on the right, 55 at the top and 60 at the bottom. The smallest spacing is 45.9% of the lettering height including the dot ring, or 71.4% of the letter body height. Letter spacing is expanded.

The adaptive foreground fits inside a central safe circle with a diameter of 66 units. The artwork is 52.8 units wide: 80% of the safe diameter. The layers share the same center and canvas; do not scale them separately. The consuming application applies the platform mask.

Letters are SVG paths; no font or image file is required. Preserve proportions and `viewBox` values. Use the monochrome badge on a contrasting surface.

The XML structure, content and geometric bounds were checked in this revision. The SVG files were not rendered; readability at 32 pixels and platform masks were not visually rechecked. No PNG output is available.
