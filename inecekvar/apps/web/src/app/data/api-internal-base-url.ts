import { InjectionToken } from '@angular/core';

// Only the server provides a value for this token.
export const API_INTERNAL_BASE_URL = new InjectionToken<string>('Internal API base URL');
