export function assertPublicPath(path: string): void {
  if (!/^\/[A-Za-z0-9\-._~/%]*$/.test(path) || path.includes('//') || path.includes('..')) {
    throw new Error('Invalid public path');
  }
}
