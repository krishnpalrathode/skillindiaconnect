import { Test, type TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { REDIS_CLIENT } from '../core/redis/redis.provider';
import { PrismaService } from '../core/prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  const mockRedis = {
    ping: jest.fn().mockResolvedValue('PONG'),
  };
  const mockPrisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns status ok with db up and redis up when both respond', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.db).toBe('up');
    expect(result.redis).toBe('up');
    expect(typeof result.timestamp).toBe('string');
  });

  it('returns redis down without throwing when Redis is unreachable', async () => {
    mockRedis.ping.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.redis).toBe('down');
    expect(result.db).toBe('up');
  });

  it('returns db down without throwing when DB is unreachable', async () => {
    mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.db).toBe('down');
    expect(result.redis).toBe('up');
  });
});
