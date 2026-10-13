import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** One run of text; `keep` runs are line codes such as `ORN-1` that must not break. */
export interface TextRun {
  text: string;
  keep: boolean;
}

const CODE = /[\p{Lu}\p{N}]+(?:-[\p{Lu}\p{N}]+)+/gu;

/**
 * Splits a line name into plain runs and line-code runs. A browser may wrap after any hyphen,
 * which splits `Hat ORN-1` into `Hat ORN-` and `1`; the code runs are rendered unbreakable.
 */
export function splitCodes(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const match of text.matchAll(CODE)) {
    const start = match.index ?? 0;
    if (start > last) runs.push({ text: text.slice(last, start), keep: false });
    runs.push({ text: match[0], keep: true });
    last = start + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), keep: false });
  return runs;
}

/** Text with its line codes kept on one line; the rest wraps normally. */
@Component({
  selector: 'iv-keep-codes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (run of runs(); track $index) {
    @if (run.keep) {
      <span class="code">{{ run.text }}</span>
    } @else {
      <ng-container>{{ run.text }}</ng-container>
    }
  }`,
  styles: `
    .code {
      white-space: nowrap;
    }
  `,
})
export class KeepCodesComponent {
  readonly text = input.required<string>();
  protected readonly runs = computed(() => splitCodes(this.text()));
}
