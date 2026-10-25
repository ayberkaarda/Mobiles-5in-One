import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The street illustration of the brand (ADR-0059; source in brand/illustrations): apartment
 * blocks and a minaret behind, a stop pole with someone hailing, and a dolmuş with its stripe
 * and "İNECEK VAR" on its board. Flat shapes only, coloured by tokens, so it
 * turns into a night street in dark mode with lit windows. The dolmuş drives in once unless
 * reduced motion is set. Decorative: hidden from assistive technology.
 */
@Component({
  selector: 'iv-city-scene',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.still]': 'still()' },
  template: `
    <svg viewBox="0 0 720 240" aria-hidden="true" focusable="false">
      <circle class="sun" cx="640" cy="52" r="26" />
      <g class="far">
        <rect x="0" y="98" width="64" height="88" />
        <rect x="68" y="62" width="52" height="124" />
        <rect x="124" y="112" width="80" height="74" />
        <rect x="208" y="78" width="58" height="108" />
        <rect x="270" y="122" width="44" height="64" />
        <rect x="318" y="90" width="70" height="96" />
        <rect x="532" y="104" width="62" height="82" />
        <rect x="598" y="70" width="50" height="116" />
        <rect x="652" y="118" width="68" height="68" />
        <rect x="432" y="58" width="10" height="128" />
        <rect x="427" y="92" width="20" height="6" rx="2" />
        <polygon points="432,58 437,26 442,58" />
        <rect x="452" y="142" width="72" height="44" />
        <path d="M456 142 A32 30 0 0 1 520 142 Z" />
      </g>
      <g class="win">
        <rect x="78" y="74" width="7" height="9" />
        <rect x="92" y="74" width="7" height="9" />
        <rect x="106" y="74" width="7" height="9" />
        <rect x="78" y="94" width="7" height="9" />
        <rect x="106" y="94" width="7" height="9" />
        <rect x="92" y="114" width="7" height="9" />
        <rect x="78" y="134" width="7" height="9" />
        <rect x="106" y="134" width="7" height="9" />
        <rect x="218" y="92" width="7" height="9" />
        <rect x="234" y="92" width="7" height="9" />
        <rect x="250" y="112" width="7" height="9" />
        <rect x="218" y="132" width="7" height="9" />
        <rect x="234" y="152" width="7" height="9" />
        <rect x="330" y="104" width="7" height="9" />
        <rect x="346" y="104" width="7" height="9" />
        <rect x="362" y="124" width="7" height="9" />
        <rect x="330" y="144" width="7" height="9" />
        <rect x="608" y="84" width="7" height="9" />
        <rect x="624" y="84" width="7" height="9" />
        <rect x="608" y="104" width="7" height="9" />
        <rect x="624" y="124" width="7" height="9" />
        <rect x="608" y="144" width="7" height="9" />
        <rect x="544" y="118" width="7" height="9" />
        <rect x="560" y="138" width="7" height="9" />
      </g>
      <path class="gull" d="M488 46 q6 -6 12 0 q6 -6 12 0 M528 30 q5 -5 10 0 q5 -5 10 0" />
      <rect class="curb" x="0" y="186" width="720" height="12" />
      <rect class="road" x="0" y="198" width="720" height="42" />
      <g class="lane">
        <rect x="14" y="217" width="30" height="4" rx="2" />
        <rect x="84" y="217" width="30" height="4" rx="2" />
        <rect x="154" y="217" width="30" height="4" rx="2" />
        <rect x="224" y="217" width="30" height="4" rx="2" />
        <rect x="294" y="217" width="30" height="4" rx="2" />
        <rect x="364" y="217" width="30" height="4" rx="2" />
        <rect x="434" y="217" width="30" height="4" rx="2" />
        <rect x="504" y="217" width="30" height="4" rx="2" />
        <rect x="574" y="217" width="30" height="4" rx="2" />
        <rect x="644" y="217" width="30" height="4" rx="2" />
      </g>
      <g class="stop">
        <rect class="ink" x="557" y="112" width="6" height="76" rx="2" />
        <circle class="sign" cx="560" cy="102" r="17" />
        <circle class="ring" cx="560" cy="102" r="6.5" />
        <rect class="stripe" x="548" y="118" width="24" height="5" rx="2.5" />
      </g>
      <g class="hail">
        <rect class="ink" x="592" y="176" width="5" height="12" rx="2" />
        <rect class="ink" x="600" y="176" width="5" height="12" rx="2" />
        <rect class="coat" x="589" y="150" width="19" height="30" rx="8" />
        <circle class="ink" cx="598" cy="141" r="7.5" />
        <path class="arm" d="M604 157 L616 136" />
      </g>
      <g class="van">
        <g transform="translate(176 128)">
          <rect class="board" x="34" y="-17" width="104" height="18" rx="3" />
          <text class="board-text" x="86" y="-4" text-anchor="middle">İNECEK VAR</text>
          <path
            class="body"
            d="M6 66 L6 20 Q6 6 20 6 L148 6 Q160 6 168 18 L186 44 Q190 50 190 56 L190 66 Z"
          />
          <rect class="glass" x="18" y="16" width="28" height="20" rx="4" />
          <rect class="glass" x="52" y="16" width="28" height="20" rx="4" />
          <rect class="glass" x="86" y="16" width="28" height="20" rx="4" />
          <rect class="glass" x="120" y="16" width="22" height="20" rx="4" />
          <polygon class="glass" points="148,16 160,16 176,40 148,40" />
          <rect class="stripe" x="6" y="44" width="184" height="7" />
          <rect class="lamp" x="180" y="54" width="9" height="6" rx="2" />
          <g class="wheel">
            <circle class="ink" cx="42" cy="68" r="14" />
            <circle class="hub" cx="42" cy="68" r="5" />
          </g>
          <g class="wheel wheel--front">
            <circle class="ink" cx="152" cy="68" r="14" />
            <circle class="hub" cx="152" cy="68" r="5" />
          </g>
        </g>
      </g>
    </svg>
  `,
  styles: `
    :host {
      display: block;
      color: var(--iv-scene-ink);
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      overflow: visible;
    }
    .far {
      fill: var(--iv-scene-far);
    }
    .win {
      fill: var(--iv-scene-win);
    }
    .sun {
      fill: var(--iv-scene-sun);
    }
    .gull,
    .arm {
      fill: none;
      stroke: currentColor;
      stroke-width: 2.5;
      stroke-linecap: round;
    }
    .arm {
      stroke-width: 5;
    }
    .curb {
      fill: var(--iv-scene-curb);
    }
    .road {
      fill: var(--iv-scene-road);
    }
    .lane rect {
      fill: var(--iv-scene-lane);
      opacity: 0.55;
    }
    .ink {
      fill: currentColor;
    }
    .sign,
    .body {
      fill: var(--iv-scene-van);
      stroke: var(--iv-scene-line);
      stroke-width: 3;
    }
    .sign {
      fill: var(--iv-plate);
    }
    .ring {
      fill: none;
      stroke: var(--iv-scene-line);
      stroke-width: 4;
    }
    .stripe,
    .coat {
      fill: var(--iv-stripe);
    }
    .glass {
      fill: var(--iv-scene-glass);
      stroke: var(--iv-scene-line);
      stroke-width: 2;
    }
    .board {
      fill: var(--iv-scene-line);
    }
    .board-text {
      fill: var(--iv-scene-board-text);
      font-family: var(--iv-font-display);
      font-weight: 700;
      font-size: 10.5px;
      letter-spacing: 0.08em;
    }
    .lamp {
      fill: var(--iv-scene-lane);
      stroke: var(--iv-scene-line);
      stroke-width: 1.5;
    }
    .wheel .ink {
      fill: var(--iv-scene-line);
      stroke: var(--iv-scene-lane);
      stroke-width: 1.5;
    }
    .hub {
      fill: var(--iv-scene-lane);
    }
    .van {
      animation: iv-drive-in 1.3s cubic-bezier(0.2, 0.75, 0.25, 1) both;
    }
    @keyframes iv-drive-in {
      from {
        transform: translateX(-210px);
      }
      to {
        transform: none;
      }
    }
    :host(.still) .van {
      animation: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .van {
        animation: none;
      }
    }
  `,
})
export class CitySceneComponent {
  /** No drive-in, for small repeated uses such as empty states. */
  readonly still = input(false);
}
