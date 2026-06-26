import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CandidateService } from './candidate.service';
import { OnboardingService } from './onboarding.service';

@Controller('candidates')
export class OnboardingController {
  constructor(
    private readonly candidateService: CandidateService,
    private readonly onboardingService: OnboardingService,
  ) {}

  @Post('me/complete-onboarding')
  @HttpCode(HttpStatus.OK)
  async completeOnboarding(@CurrentUser() user: CurrentUserPayload) {
    this.candidateService.assertCandidateRole(user.role);
    const candidateId = await this.candidateService.getCandidateIdByUserId(user.userId);
    return { data: await this.onboardingService.complete(candidateId) };
  }
}
