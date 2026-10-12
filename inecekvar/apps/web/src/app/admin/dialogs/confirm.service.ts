import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  /** Plain text; rendered with interpolation, never as markup. */
  body: string;
  confirmLabel: string;
}

/** One confirmation at a time for destructive actions (rollback, retirement, role change). */
@Injectable()
export class ConfirmService {
  readonly request = signal<ConfirmRequest | null>(null);
  private resolve: ((value: boolean) => void) | null = null;

  ask(request: ConfirmRequest): Promise<boolean> {
    this.resolve?.(false);
    this.request.set(request);
    return new Promise<boolean>((resolve) => {
      this.resolve = resolve;
    });
  }

  answer(value: boolean): void {
    const resolve = this.resolve;
    this.resolve = null;
    this.request.set(null);
    resolve?.(value);
  }
}
