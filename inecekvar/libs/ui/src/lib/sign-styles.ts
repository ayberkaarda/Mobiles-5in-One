/**
 * Styles of the sign family that travel with the components using them (ADR-0059), so the
 * initial stylesheet of the app stays small. Each constant is a plain CSS string for the
 * `styles` array of a component.
 */
export const PLACARD_STYLES = `
/* Line-code placard: the yellow window sign of a dolmuş with the turquoise minibüs stripe and
   two rivets. The code never wraps. */
.iv-placard {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: 3.9em;
  padding: 0.5em 0.6em 0.42em;
  border-radius: 0.42em;
  background: var(--iv-plate);
  color: var(--iv-plate-ink);
  box-shadow:
    inset 0 -0.24em 0 var(--iv-stripe),
    0 0 0 2px var(--iv-plate-ink);
  font-family: var(--iv-font-display);
  font-weight: var(--iv-font-display-weight);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.035em;
  line-height: 1;
  white-space: nowrap;
}

.iv-placard::before,
.iv-placard::after {
  content: '';
  position: absolute;
  top: 0.26em;
  width: 0.2em;
  height: 0.2em;
  border-radius: 50%;
  background: var(--iv-plate-ink);
  opacity: 0.55;
}

.iv-placard::before {
  left: 0.3em;
}

.iv-placard::after {
  right: 0.3em;
}

.iv-placard--s {
  font-size: 13px;
  min-width: 3.6em;
}

.iv-placard--l {
  font-size: 22px;
}

.iv-placard--xl {
  font-size: clamp(26px, 8vw, 40px);
  border-radius: 0.3em;
}
`;

export const SIGN_TEXT_STYLES = `
/* Sign lettering on a board: the one place where capitals belong. */
.iv-sign-text {
  font-family: var(--iv-font-display);
  font-weight: var(--iv-font-display-weight);
  color: var(--iv-board-sign);
  text-shadow: var(--iv-board-glow);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Destination flip: each row of a sign turns in once from the top edge, row by row. */
@keyframes iv-flip-in {
  from {
    transform: perspective(400px) rotateX(-88deg);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

.iv-flip {
  display: block;
  transform-origin: 50% 0;
  animation: iv-flip-in 520ms var(--iv-ease-flip) both;
  animation-delay: 60ms;
}

.iv-flip--1 {
  animation-delay: 150ms;
}

.iv-flip--2 {
  animation-delay: 240ms;
}

@media (prefers-reduced-motion: reduce) {
  .iv-flip {
    animation: none;
  }
}
`;
