// Fixture for iv-angular-bypass-security-trust (semgrep --test).
import { inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export class LineNotePositive {
  private readonly sanitizer = inject(DomSanitizer);

  render(note: string): SafeHtml {
    // ruleid: iv-angular-bypass-security-trust
    return this.sanitizer.bypassSecurityTrustHtml(note);
  }

  link(url: string): unknown {
    // ruleid: iv-angular-bypass-security-trust
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
}

export class LineNoteNegative {
  private readonly sanitizer = inject(DomSanitizer);

  render(note: string): string | null {
    // ok: iv-angular-bypass-security-trust
    return this.sanitizer.sanitize(1, note);
  }
}
