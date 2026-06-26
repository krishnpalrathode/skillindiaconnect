import { Controller, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { AccountService } from './account.service';

@Controller('account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Delete()
  @HttpCode(HttpStatus.ACCEPTED)
  async requestDeletion(@CurrentUser() user: CurrentUserPayload) {
    return { data: await this.accountService.requestDeletion(user.userId) };
  }
}
