import { Test, type TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { REDIS_CLIENT } from '../core/redis/redis.provider';

describe('HealthController', () => {
  let controller: HealthController;
  const mockRedis = {
    ping: jest.fn().mockResolvedValue('PONG'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: REDIS_CLIENT, useValue: mockRedis }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns status ok with redis up when Redis responds', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.redis).toBe('up');
    expect(typeof result.timestamp).toBe('string');
  });

  it('returns redis down without throwing when Redis is unreachable', async () => {
    mockRedis.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.redis).toBe('down');
  });
});
