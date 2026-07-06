import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplyDto } from './dto/apply.dto';

/** Fast unit test — the cover-letter length contract (≤500), no container. */
describe('ApplyDto validation', () => {
  async function errorsFor(payload: unknown) {
    const dto = plainToInstance(ApplyDto, payload);
    return validate(dto as object);
  }

  it('accepts an empty body (coverLetter is optional)', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it('accepts a cover letter at the 500-char boundary', async () => {
    expect(await errorsFor({ coverLetter: 'a'.repeat(500) })).toHaveLength(0);
  });

  it('rejects a cover letter over 500 chars', async () => {
    const errors = await errorsFor({ coverLetter: 'a'.repeat(501) });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('maxLength');
  });

  it('rejects a non-string cover letter', async () => {
    const errors = await errorsFor({ coverLetter: 123 });
    expect(errors[0]?.constraints).toHaveProperty('isString');
  });
});
