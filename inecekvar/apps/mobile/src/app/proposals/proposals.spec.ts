import { TestBed } from '@angular/core/testing';
import { ApiError, ContributionApi, SessionStore } from '@inecekvar/data-access';
import { LicenceGate } from '../auth/licence-gate';
import {
  fakeContributions,
  FakeSession,
  sampleLineDetail,
  sampleStopDetail,
  SAMPLE_CITY,
  settle,
} from '../testing/catalog.fixtures';
import { checkPhoto, PHOTO_MAX_BYTES, PhotoUploader, sniffPhotoType } from './photo-upload';
import {
  buildFareUpdate,
  buildNewLine,
  buildNewStop,
  buildRetire,
  buildUpdateLine,
  buildUpdateStop,
  emptyFields,
  fieldsFromLine,
  fieldsFromStop,
  parseFare,
} from './proposal-form';

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const WEBP = [...'RIFF']
  .map((c) => c.charCodeAt(0))
  .concat(
    [0, 0, 0, 0],
    [...'WEBP'].map((c) => c.charCodeAt(0)),
  );
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

function file(bytes: number[], type: string, size = bytes.length): File {
  const body = new Uint8Array(size);
  body.set(bytes.slice(0, size));
  return new File([body], 'foto', { type });
}

describe('fare input', () => {
  it.each([
    ['25', 2500],
    ['25,5', 2550],
    ['25,50', 2550],
    ['25.50', 2550],
    ['₺ 1.250,00', 125000],
    ['0', 0],
    ['100000', 10_000_000],
  ])('reads %s as %d kuruş', (input, minor) => {
    expect(parseFare(input)).toBe(minor);
  });

  it.each(['abc', '-5', '25,555', '100000,01', '1234567'])('refuses %s', (input) => {
    expect(parseFare(input)).toBe('invalid');
  });

  it('treats an empty field as no fare', () => {
    expect(parseFare('  ')).toBeNull();
  });
});

describe('proposal builders', () => {
  const line = sampleLineDetail();

  it('validates a new line against the contract bounds', () => {
    const result = buildNewLine(SAMPLE_CITY.slug, {
      ...emptyFields(),
      code: 'x'.repeat(33),
      hours: 'h'.repeat(501),
      fare: '12,345',
      stopIds: ['stop-1'],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject({
      code: 'proposal.errors.tooLong',
      name: 'proposal.errors.required',
      mode: 'proposal.errors.required',
      fare: 'proposal.errors.fare',
      hours: 'proposal.errors.tooLong',
      stopIds: 'proposal.errors.stopsMin',
    });
  });

  it('builds a new line with a trace as its geometry source', () => {
    const result = buildNewLine(SAMPLE_CITY.slug, {
      ...emptyFields(),
      code: ' ORN-9 ',
      name: ' Yeni hat ',
      mode: 'minibus',
      fare: '30',
      payments: ['nakit', 'kart'],
      stopIds: ['a', 'b', 'a'],
      traceId: 'trace-1',
      photoId: 'photo-1',
    });
    expect(result).toEqual({
      ok: true,
      proposal: {
        kind: 'new_line',
        city: SAMPLE_CITY.slug,
        code: 'ORN-9',
        name: 'Yeni hat',
        mode: 'minibus',
        stop_ids: ['a', 'b'],
        fare_minor: 3000,
        hours_text: null,
        hail_notes: null,
        payment_methods: ['nakit', 'kart'],
        trace_id: 'trace-1',
        geometry_source: 'trace',
        photo_id: 'photo-1',
      },
    });
  });

  it('sends only the changed fields of a line update on top of its version', () => {
    const fields = { ...fieldsFromLine(line), fare: '30', payments: ['kart', 'nakit'] as const };
    const result = buildUpdateLine(line, { ...fields, payments: [...fields.payments] });
    expect(result).toEqual({
      ok: true,
      proposal: {
        kind: 'update_line',
        line: 'line-1',
        base_version_no: 1,
        changes: { fare_minor: 3000, payment_methods: ['kart', 'nakit'] },
        photo_id: null,
      },
    });
  });

  it('refuses an update that changes nothing (an emptied field means unchanged)', () => {
    const result = buildUpdateLine(line, { ...fieldsFromLine(line), hours: '' });
    expect(result).toEqual({ ok: false, errors: { form: 'proposal.errors.noChange' } });
  });

  it('requires a new, valid fare for a fare update', () => {
    expect(buildFareUpdate(line, { ...emptyFields(), fare: '' }).ok).toBe(false);
    expect(buildFareUpdate(line, { ...emptyFields(), fare: '25' })).toEqual({
      ok: false,
      errors: { fare: 'proposal.errors.sameFare' },
    });
    expect(buildFareUpdate(line, { ...emptyFields(), fare: '27,5' })).toEqual({
      ok: true,
      proposal: {
        kind: 'fare_update',
        line: 'line-1',
        base_version_no: 1,
        fare_minor: 2750,
        photo_id: null,
      },
    });
  });

  it('requires a bounded reason to retire a line', () => {
    expect(buildRetire(line, { ...emptyFields(), reason: '  ' }).ok).toBe(false);
    expect(buildRetire(line, { ...emptyFields(), reason: 'r'.repeat(501) }).ok).toBe(false);
    expect(buildRetire(line, { ...emptyFields(), reason: 'Hat kalktı' })).toMatchObject({
      ok: true,
      proposal: { kind: 'retire', line: 'line-1', reason: 'Hat kalktı' },
    });
  });

  it('places a new stop inside the city only', () => {
    const base = { ...emptyFields(), stopName: 'Fırın önü' };
    expect(buildNewStop(SAMPLE_CITY.slug, SAMPLE_CITY.bbox, base)).toEqual({
      ok: false,
      errors: { location: 'proposal.errors.location' },
    });
    expect(
      buildNewStop(SAMPLE_CITY.slug, SAMPLE_CITY.bbox, { ...base, location: [35, 42.55] }),
    ).toEqual({ ok: false, errors: { location: 'proposal.errors.outsideCity' } });
    expect(
      buildNewStop(SAMPLE_CITY.slug, SAMPLE_CITY.bbox, { ...base, location: [34.05, 42.55] }),
    ).toEqual({
      ok: true,
      proposal: {
        kind: 'new_stop',
        city: SAMPLE_CITY.slug,
        name: 'Fırın önü',
        location: [34.05, 42.55],
        stop_kind: 'informal',
        photo_id: null,
      },
    });
  });

  it('diffs a stop update', () => {
    const stop = sampleStopDetail();
    expect(buildUpdateStop(stop, SAMPLE_CITY.bbox, fieldsFromStop(stop)).ok).toBe(false);
    expect(
      buildUpdateStop(stop, SAMPLE_CITY.bbox, { ...fieldsFromStop(stop), stopKind: 'informal' }),
    ).toEqual({
      ok: true,
      proposal: {
        kind: 'update_stop',
        stop: stop.id,
        changes: { kind: 'informal' },
        photo_id: null,
      },
    });
  });
});

describe('photo checks', () => {
  it('reads the real type from the first bytes', async () => {
    expect(await sniffPhotoType(file(JPEG, 'image/jpeg'))).toBe('image/jpeg');
    expect(await sniffPhotoType(file(WEBP, 'image/webp'))).toBe('image/webp');
    expect(await sniffPhotoType(file(PNG, 'image/jpeg'))).toBeNull();
  });

  it('accepts JPEG and WebP up to 4 MiB and refuses the rest', async () => {
    expect(await checkPhoto(file(JPEG, 'image/jpeg'))).toEqual({ ok: true, type: 'image/jpeg' });
    expect(await checkPhoto(file(WEBP, 'image/webp'))).toEqual({ ok: true, type: 'image/webp' });
    expect(await checkPhoto(file(PNG, 'image/png'))).toEqual({ ok: false, reason: 'type' });
    // A PNG renamed to .jpg.
    expect(await checkPhoto(file(PNG, 'image/jpeg'))).toEqual({ ok: false, reason: 'type' });
    expect(await checkPhoto(file(JPEG, 'image/jpeg', PHOTO_MAX_BYTES + 1))).toEqual({
      ok: false,
      reason: 'size',
    });
    expect(await checkPhoto(file(JPEG, 'image/jpeg', PHOTO_MAX_BYTES))).toEqual({
      ok: true,
      type: 'image/jpeg',
    });
    expect(await checkPhoto(new File([], 'x', { type: 'image/jpeg' }))).toEqual({
      ok: false,
      reason: 'empty',
    });
  });
});

describe('PhotoUploader', () => {
  function setup(licence = true) {
    const session = new FakeSession();
    session.signIn('user-a', licence);
    const contributions = fakeContributions();
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionStore, useValue: session },
        { provide: ContributionApi, useValue: contributions },
      ],
    });
    const uploader = TestBed.runInInjectionContext(() => new PhotoUploader());
    return { uploader, contributions, gate: TestBed.inject(LicenceGate) };
  }

  it('presigns with the checked type and exact size, then PUTs the file', async () => {
    const { uploader, contributions } = setup();
    const photo = file(JPEG, 'image/jpeg', 2048);
    await uploader.choose(photo, 'fare_table');
    expect(contributions.presignPhoto.calls).toEqual([
      [{ kind: 'fare_table', content_type: 'image/jpeg', byte_size: 2048 }],
    ]);
    expect(contributions.uploadPhoto.calls[0]?.[1]).toBe(photo);
    expect(uploader.state()).toEqual({
      status: 'done',
      photoId: '01920000-0000-7000-8000-0000000000aa',
      bytes: 2048,
    });
    expect(uploader.photoId()).toBe('01920000-0000-7000-8000-0000000000aa');
    // Attachable once the presign window (300 s) and one worker run have passed.
    expect(uploader.processing.seconds()).toBe(360);
    uploader.clear();
    expect(uploader.processing.active()).toBe(false);
  });

  it('refuses a wrong file before any request', async () => {
    const { uploader, contributions } = setup();
    await uploader.choose(file(PNG, 'image/jpeg'), 'stop_sign');
    expect(uploader.state()).toEqual({ status: 'rejected', reason: 'type' });
    expect(contributions.presignPhoto.calls).toHaveLength(0);
  });

  it('reports a presign failure and an interrupted upload, then retries with a new presign', async () => {
    const { uploader, contributions } = setup();
    contributions.presignPhoto.impl = async () => {
      throw new ApiError('problem', 503, 'storage.unavailable', 'req');
    };
    await uploader.choose(file(JPEG, 'image/jpeg'), 'fare_table');
    expect(uploader.state()).toEqual({ status: 'failed', key: 'proposal.photo.unavailable' });

    contributions.presignPhoto.impl = fakeContributions().presignPhoto.impl;
    contributions.uploadPhoto.impl = async () => {
      throw new ApiError('http', 403, 'upload.403', 'upload');
    };
    await uploader.retry();
    expect(uploader.state()).toEqual({ status: 'failed', key: 'proposal.photo.uploadFailed' });
    expect(uploader.photoId()).toBeNull();

    contributions.uploadPhoto.impl = async () => undefined;
    await uploader.retry();
    expect(uploader.state().status).toBe('done');
    expect(contributions.presignPhoto.calls).toHaveLength(3);
  });

  it('counts down a presign quota answer', async () => {
    const { uploader, contributions } = setup();
    contributions.presignPhoto.impl = async () => {
      throw new ApiError('rate_limited', 429, 'rate_limited', 'req', null, 600);
    };
    await uploader.choose(file(JPEG, 'image/jpeg'), 'fare_table');
    expect(uploader.state()).toEqual({ status: 'failed', key: 'proposal.photo.rateLimited' });
    expect(uploader.countdown.seconds()).toBeGreaterThan(590);
    await uploader.retry();
    expect(contributions.presignPhoto.calls).toHaveLength(1);
  });

  it('asks for the licence before presigning', async () => {
    const { uploader, contributions, gate } = setup(false);
    const pending = uploader.choose(file(JPEG, 'image/jpeg'), 'fare_table');
    await settle();
    expect(gate.open()).toBe(true);
    gate.decline();
    await pending;
    expect(uploader.state()).toEqual({ status: 'failed', key: 'proposal.photo.licence' });
    expect(contributions.presignPhoto.calls).toHaveLength(0);
  });
});
