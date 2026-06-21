import { Test, TestingModule } from '@nestjs/testing';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  // argon2 is intentionally slow — allow extra time for all tests in this suite.
  beforeAll(() => {
    jest.setTimeout(30_000);
  });
  afterAll(() => {
    jest.setTimeout(5_000);
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PasswordService],
    }).compile();

    service = module.get(PasswordService);
  });

  it('produces a hash that verifies correctly', async () => {
    const hash = await service.hashPassword('Hunter2!abc');
    expect(typeof hash).toBe('string');
    expect(hash).not.toBe('Hunter2!abc');
    await expect(service.verify(hash, 'Hunter2!abc')).resolves.toBe(true);
  });

  it('returns false for a wrong password', async () => {
    const hash = await service.hashPassword('Correct1pass');
    await expect(service.verify(hash, 'Wrong1pass')).resolves.toBe(false);
  });

  it('produces different hashes for the same input (salt randomness)', async () => {
    const h1 = await service.hashPassword('Same1pass');
    const h2 = await service.hashPassword('Same1pass');
    expect(h1).not.toBe(h2);
  });
});
