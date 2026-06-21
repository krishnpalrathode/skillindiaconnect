import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PermissionService } from './permission.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { REDIS_CLIENT } from '../../core/redis/redis.provider';
import { Permission } from './permission.constants';

const ROLE = UserRole.SUPER_ADMIN;
const KEY = Permission.CANDIDATES_VIEW;

describe('PermissionService', () => {
  let service: PermissionService;
  let prismaMock: {
    rolePermission: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };
  let redisMock: { get: jest.Mock; setex: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    prismaMock = {
      rolePermission: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    redisMock = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    service = module.get(PermissionService);
  });

  describe('getPermissionsForRole', () => {
    it('returns only enabled=true keys (filtered at DB layer)', async () => {
      prismaMock.rolePermission.findMany.mockResolvedValue([
        { permissionKey: KEY },
        { permissionKey: Permission.CANDIDATES_EDIT },
      ]);
      const perms = await service.getPermissionsForRole(ROLE);
      expect(perms.size).toBe(2);
      expect(perms.has(KEY)).toBe(true);
      expect(perms.has(Permission.CANDIDATES_EDIT)).toBe(true);
      expect(prismaMock.rolePermission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role: ROLE, enabled: true } }),
      );
    });

    it('returns empty set for a role with no enabled rows', async () => {
      prismaMock.rolePermission.findMany.mockResolvedValue([]);
      const perms = await service.getPermissionsForRole(UserRole.CANDIDATE);
      expect(perms.size).toBe(0);
    });

    it('populates the Redis cache after a DB miss', async () => {
      prismaMock.rolePermission.findMany.mockResolvedValue([{ permissionKey: KEY }]);
      await service.getPermissionsForRole(ROLE);
      expect(redisMock.setex).toHaveBeenCalledWith(
        `rbac:perms:${ROLE}`,
        300,
        JSON.stringify([KEY]),
      );
    });

    it('does NOT re-query the DB on a cache hit (second call within TTL)', async () => {
      prismaMock.rolePermission.findMany.mockResolvedValue([{ permissionKey: KEY }]);

      // First call — cache miss, hits DB.
      redisMock.get.mockResolvedValueOnce(null);
      await service.getPermissionsForRole(ROLE);
      expect(prismaMock.rolePermission.findMany).toHaveBeenCalledTimes(1);

      // Second call — cache hit, no DB query.
      redisMock.get.mockResolvedValueOnce(JSON.stringify([KEY]));
      const perms = await service.getPermissionsForRole(ROLE);
      expect(prismaMock.rolePermission.findMany).toHaveBeenCalledTimes(1);
      expect(perms.has(KEY)).toBe(true);
    });
  });

  describe('hasPermission', () => {
    it('returns true when the role has the key', async () => {
      prismaMock.rolePermission.findMany.mockResolvedValue([{ permissionKey: KEY }]);
      await expect(service.hasPermission(ROLE, KEY)).resolves.toBe(true);
    });

    it('returns false when the role lacks the key', async () => {
      prismaMock.rolePermission.findMany.mockResolvedValue([]);
      await expect(service.hasPermission(ROLE, KEY)).resolves.toBe(false);
    });
  });

  describe('setPermission', () => {
    it('throws 423 PERMISSION_LOCKED and makes no DB writes when the row is locked', async () => {
      prismaMock.rolePermission.findUnique.mockResolvedValue({
        id: '1',
        role: ROLE,
        permissionKey: KEY,
        enabled: true,
        isLocked: true,
        updatedAt: new Date(),
      });

      await expect(service.setPermission(ROLE, KEY, false, 'actor-id')).rejects.toThrow(
        HttpException,
      );
      await expect(service.setPermission(ROLE, KEY, false, 'actor-id')).rejects.toMatchObject({
        status: 423,
      });
      expect(prismaMock.rolePermission.update).not.toHaveBeenCalled();
      expect(redisMock.del).not.toHaveBeenCalled();
    });

    it('updates enabled, invalidates the cache, and writes an audit log for an unlocked row', async () => {
      prismaMock.rolePermission.findUnique.mockResolvedValue({
        id: '1',
        role: ROLE,
        permissionKey: KEY,
        enabled: true,
        isLocked: false,
        updatedAt: new Date(),
      });
      prismaMock.rolePermission.update.mockResolvedValue({});

      await service.setPermission(ROLE, KEY, false, 'actor-id');

      expect(prismaMock.rolePermission.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { enabled: false } }),
      );
      expect(redisMock.del).toHaveBeenCalledWith(`rbac:perms:${ROLE}`);
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorUserId: 'actor-id',
            action: 'PERMISSION_UPDATE',
            module: 'auth',
          }),
        }),
      );
    });

    it('throws NotFoundException when the row does not exist', async () => {
      prismaMock.rolePermission.findUnique.mockResolvedValue(null);
      await expect(service.setPermission(ROLE, KEY, true, 'actor-id')).rejects.toMatchObject({
        status: 404,
      });
    });
  });
});
