import { DestroyRef, inject, signal } from '@angular/core';
import { ContributionApi, isApiError } from '@inecekvar/data-access';
import { LicenceGate } from '../auth/licence-gate';
import { TranslationKey } from '../i18n/translation';
import { Countdown } from '../shared/countdown';

/** Spec section 6.7 and `PresignInput`: JPEG or WebP, at most 4 MiB. */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
export type PhotoType = 'image/jpeg' | 'image/webp';
export type PhotoKind = 'fare_table' | 'stop_sign';

export type PhotoState =
  | { status: 'idle' }
  | { status: 'rejected'; reason: 'type' | 'size' | 'empty' }
  | { status: 'uploading'; step: 'presign' | 'upload' }
  | { status: 'done'; photoId: string; bytes: number }
  | { status: 'failed'; key: TranslationKey };

async function head(file: Blob, length: number): Promise<Uint8Array> {
  const part = file.slice(0, length);
  if (typeof part.arrayBuffer === 'function') return new Uint8Array(await part.arrayBuffer());
  // Older WebViews (and jsdom) only offer FileReader.
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(part);
  });
  return new Uint8Array(buffer);
}

/**
 * The real type from the first bytes (JPEG `FF D8 FF`, WebP `RIFF....WEBP`), so a renamed
 * file is refused before anything is sent. The worker checks the magic bytes again.
 */
export async function sniffPhotoType(file: Blob): Promise<PhotoType | null> {
  const b = await head(file, 12);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function checkPhoto(
  file: Blob,
): Promise<{ ok: true; type: PhotoType } | { ok: false; reason: 'type' | 'size' | 'empty' }> {
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (file.type !== 'image/jpeg' && file.type !== 'image/webp')
    return { ok: false, reason: 'type' };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, reason: 'size' };
  const sniffed = await sniffPhotoType(file);
  if (sniffed === null || sniffed !== file.type) return { ok: false, reason: 'type' };
  return { ok: true, type: sniffed };
}

/**
 * One photo of a fare table or stop sign: checked on the device, then a presigned PUT straight
 * to object storage. The file is sent as chosen; the app never reads its EXIF data and never
 * shows or uses a location from it. The worker re-encodes the image without metadata
 * (ADR-0023). Create in an injection context (a page).
 */
export class PhotoUploader {
  private readonly api = inject(ContributionApi);
  private readonly licence = inject(LicenceGate);
  private controller: AbortController | null = null;
  private file: Blob | null = null;
  private kind: PhotoKind = 'fare_table';

  readonly state = signal<PhotoState>({ status: 'idle' });
  readonly countdown = new Countdown();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.controller?.abort());
  }

  photoId(): string | null {
    const state = this.state();
    return state.status === 'done' ? state.photoId : null;
  }

  async choose(file: Blob, kind: PhotoKind): Promise<void> {
    this.controller?.abort();
    this.file = null;
    const check = await checkPhoto(file);
    if (!check.ok) {
      this.state.set({ status: 'rejected', reason: check.reason });
      return;
    }
    this.file = file;
    this.kind = kind;
    await this.send(check.type);
  }

  async retry(): Promise<void> {
    if (!this.file || this.countdown.active()) return;
    const check = await checkPhoto(this.file);
    if (check.ok) await this.send(check.type);
  }

  clear(): void {
    this.controller?.abort();
    this.controller = null;
    this.file = null;
    this.state.set({ status: 'idle' });
  }

  private async send(type: PhotoType): Promise<void> {
    const file = this.file;
    if (!file) return;
    // Presigning needs the licence, like every contribution.
    if (!(await this.licence.ensure())) {
      this.state.set({ status: 'failed', key: 'proposal.photo.licence' });
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    try {
      this.state.set({ status: 'uploading', step: 'presign' });
      const presigned = await this.api.presignPhoto({
        kind: this.kind,
        content_type: type,
        byte_size: file.size,
      });
      if (controller.signal.aborted) return;
      this.state.set({ status: 'uploading', step: 'upload' });
      await this.api.uploadPhoto(presigned, file, controller.signal);
      if (controller.signal.aborted) return;
      this.state.set({ status: 'done', photoId: presigned.photo_id, bytes: file.size });
    } catch (error) {
      if (controller.signal.aborted) return;
      this.state.set({ status: 'failed', key: this.failureKey(error) });
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  private failureKey(error: unknown): TranslationKey {
    if (!isApiError(error)) return 'proposal.photo.failed';
    if (error.status === 429) {
      this.countdown.start(error.retryAfterSeconds);
      return 'proposal.photo.rateLimited';
    }
    if (error.kind === 'network' || error.kind === 'timeout') return 'proposal.photo.offline';
    if (error.code === 'media.too_large') return 'proposal.photo.size';
    if (error.code === 'storage.unavailable') return 'proposal.photo.unavailable';
    if (error.code === 'auth.forbidden') return 'proposal.photo.licence';
    if (error.code.startsWith('upload.')) return 'proposal.photo.uploadFailed';
    return 'proposal.photo.failed';
  }
}
