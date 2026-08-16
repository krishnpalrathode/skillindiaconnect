import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from './uploads';
import { DOC_LIMITS, ACCEPTED_DOC_TYPES } from '../candidate/document.constants';
import { CERT_MAX_BYTES } from '../employer/dto/presign-cert.dto';
import { LOGO_MAX_BYTES } from '../employer/dto/presign-logo.dto';

/**
 * One ceiling, everywhere.
 *
 * These limits had ALREADY drifted before they were unified — a 10 MB passport
 * in the API, 5 MB in the contract, 5 MB in one UI and 10 in another. Nothing
 * failed when they diverged, so nothing stopped it. This suite is that
 * something: it fails the moment a second number appears.
 */
describe('upload ceiling', () => {
  it('is 2 MB', () => {
    expect(MAX_UPLOAD_MB).toBe(2);
    expect(MAX_UPLOAD_BYTES).toBe(2 * 1024 * 1024);
  });

  it.each(ACCEPTED_DOC_TYPES)('%s uses the shared ceiling', (type) => {
    expect(DOC_LIMITS[type].maxBytes).toBe(MAX_UPLOAD_BYTES);
  });

  it('the employer certificate and logo use it too', () => {
    expect(CERT_MAX_BYTES).toBe(MAX_UPLOAD_BYTES);
    expect(LOGO_MAX_BYTES).toBe(MAX_UPLOAD_BYTES);
  });

  it('the presign DTOs cap at it — a client cannot declare more', () => {
    // Read as source: the decorators are metadata, and asserting on the text is
    // what catches someone pasting a literal back in.
    const dtos = [
      '../candidate/dto/presign-document.dto.ts',
      '../candidate/dto/presign-photo.dto.ts',
      '../employer/dto/presign-cert.dto.ts',
      '../employer/dto/presign-logo.dto.ts',
    ];
    for (const rel of dtos) {
      const src = readFileSync(join(__dirname, rel), 'utf8');
      const max = src.match(/@Max\(([^)]+)\)/);
      expect(max).not.toBeNull();
      // The capture group exists whenever the match does; the non-null assertion
      // is safe because the line above already failed if it did not.
      const capped = max?.[1]?.trim() ?? "";
      expect(capped).toMatch(/MAX_UPLOAD_BYTES|CERT_MAX_BYTES|LOGO_MAX_BYTES/);
    }
  });

  it('the web mirror agrees with this one', () => {
    const web = readFileSync(
      join(__dirname, '..', '..', '..', 'web', 'src', 'lib', 'uploads.ts'),
      'utf8',
    );
    const mb = web.match(/export const MAX_UPLOAD_MB = (\d+)/);
    expect(mb).not.toBeNull();
    expect(Number(mb![1])).toBe(MAX_UPLOAD_MB);
  });

  it('the contract documents the same number', () => {
    const yaml = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'packages', 'contract', 'openapi.yaml'),
      'utf8',
    );
    // No upload description may still advertise a larger allowance.
    const stale = yaml.match(/(?:Max|max)[^\n]{0,12}\b(?:5|10|20|50)\s*MB/g) ?? [];
    expect(stale).toEqual([]);
  });
});
