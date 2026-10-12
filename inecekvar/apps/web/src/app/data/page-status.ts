import { isPlatformServer } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, RESPONSE_INIT } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PageStatus {
  private readonly server = isPlatformServer(inject(PLATFORM_ID));
  private readonly response = inject(RESPONSE_INIT, { optional: true });

  notFound(): void {
    if (this.server && this.response) {
      this.response.status = 404;
    }
  }

  unavailable(): void {
    if (this.server && this.response) {
      this.response.status = 503;
      const headers = new Headers(this.response.headers);
      headers.set('Retry-After', '120');
      this.response.headers = headers;
    }
  }
}
