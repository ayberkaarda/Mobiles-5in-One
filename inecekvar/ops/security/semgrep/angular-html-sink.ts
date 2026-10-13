// Fixture for iv-angular-html-sink (semgrep --test).
import { Renderer2 } from '@angular/core';

export function positives(element: HTMLElement, renderer: Renderer2, note: string): void {
  // ruleid: iv-angular-html-sink
  element.innerHTML = note;
  // ruleid: iv-angular-html-sink
  element.outerHTML = `<p>${note}</p>`;
  // ruleid: iv-angular-html-sink
  element.insertAdjacentHTML('beforeend', note);
  // ruleid: iv-angular-html-sink
  document.write(note);
  // ruleid: iv-angular-html-sink
  renderer.setProperty(element, 'innerHTML', note);
}

export function negatives(element: HTMLElement, renderer: Renderer2, note: string): string {
  // ok: iv-angular-html-sink
  element.textContent = note;
  // ok: iv-angular-html-sink
  element.innerHTML = '';
  // ok: iv-angular-html-sink
  renderer.setProperty(element, 'textContent', note);
  // ok: iv-angular-html-sink
  return element.outerHTML.slice(0, 60);
}
