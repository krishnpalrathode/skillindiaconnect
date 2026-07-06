import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ApplyController } from './apply.controller';
import { ApplyService } from './apply.service';
import { ApplyDto } from './dto/apply.dto';

/** Fast unit test — the controller's role gate + delegation, no container. */
describe('ApplyController', () => {
  const applyResult = { id: 'app-1', humanId: 'AP-2026-1' };
  const applyService = {
    apply: jest.fn().mockResolvedValue(applyResult),
  } as unknown as ApplyService;
  const controller = new ApplyController(applyService);

  const user = (role: UserRole): CurrentUserPayload => ({
    userId: 'u-1',
    role,
    jti: 'j',
    exp: 0,
  });

  beforeEach(() => jest.clearAllMocks());

  it('rejects a non-candidate (EMPLOYER) with 403 NOT_CANDIDATE and never calls the service', async () => {
    await expect(
      controller.apply('job-1', {} as ApplyDto, user(UserRole.EMPLOYER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(applyService.apply).not.toHaveBeenCalled();
  });

  it('rejects an ADMIN with 403 too', async () => {
    await expect(
      controller.apply('job-1', {} as ApplyDto, user(UserRole.ADMIN)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delegates to ApplyService for a CANDIDATE and wraps in { data }', async () => {
    const dto: ApplyDto = { coverLetter: 'hi' };
    const res = await controller.apply('job-1', dto, user(UserRole.CANDIDATE));
    expect(applyService.apply).toHaveBeenCalledWith('u-1', 'job-1', dto, UserRole.CANDIDATE);
    expect(res).toEqual({ data: applyResult });
  });
});
