import { DOCUMENT } from '@angular/common';
import { inject, Injectable, RendererFactory2 } from '@angular/core';
import { JsonLdNode, serializeJsonLd } from './json-ld';

@Injectable({ providedIn: 'root' })
export class JsonLdService {
  private readonly document = inject(DOCUMENT);
  private readonly renderer = inject(RendererFactory2).createRenderer(null, null);

  set(id: string, nodes: readonly JsonLdNode[]): void {
    this.validateId(id);
    const text = serializeJsonLd(nodes);
    this.clear(id);
    const script = this.renderer.createElement('script');
    // A JSON-LD data block is not executed and needs no nonce.
    this.renderer.setAttribute(script, 'type', 'application/ld+json');
    this.renderer.setAttribute(script, 'data-iv-jsonld', id);
    this.renderer.appendChild(script, this.renderer.createText(text));
    this.renderer.appendChild(this.document.head, script);
  }

  clear(id: string): void {
    this.validateId(id);
    for (const script of this.document.head.querySelectorAll(`script[data-iv-jsonld="${id}"]`)) {
      this.renderer.removeChild(this.document.head, script);
    }
  }

  clearAll(): void {
    for (const script of this.document.head.querySelectorAll('script[data-iv-jsonld]')) {
      this.renderer.removeChild(this.document.head, script);
    }
  }

  private validateId(id: string): void {
    if (!/^[a-z0-9-]{1,32}$/.test(id)) {
      throw new Error('Invalid JSON-LD id');
    }
  }
}
