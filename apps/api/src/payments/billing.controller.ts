import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { validationProblemFactory } from '../core/http-problem.filter';
import {
  BillingPlanDto,
  CheckoutService,
  CheckoutSessionDto,
  InvoiceDto,
  OrderDto,
  SubscriptionStatusDto,
} from './checkout.service';
import { CheckoutDto } from './dto/checkout.dto';

/**
 * Rejects unknown checkout-body fields with 400 BEFORE any pipe runs.
 *
 * WHY A GUARD, NOT A PIPE: Nest executes GLOBAL pipes before route-level
 * pipes, and the global ValidationPipe (`whitelist: true`, non-forbidding)
 * SILENTLY STRIPS unknown fields — so a route-level `forbidNonWhitelisted`
 * pipe never sees a smuggled `gateway`/`amountSubunits` field (found live:
 * the smuggled field sailed through to the service). Guards run BEFORE pipes
 * and read the raw parsed body, making this the earliest reliable rejection
 * point. The route-level pipe below stays as defense-in-depth for the case
 * where the global pipe configuration ever changes.
 */
@Injectable()
export class CheckoutBodyGuard implements CanActivate {
  private static readonly ALLOWED = new Set(['planCode']);

  canActivate(ctx: ExecutionContext): boolean {
    const body =
      ctx.switchToHttp().getRequest<{ body?: Record<string, unknown> }>().body ?? {};
    const smuggled = Object.keys(body).filter((k) => !CheckoutBodyGuard.ALLOWED.has(k));
    if (smuggled.length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        detail: `Unknown field(s): ${smuggled.join(', ')}. The checkout request carries { planCode } only — gateway and money are server-side.`,
        meta: { errors: smuggled.map((field) => ({ field, code: 'unknownField' })) },
      });
    }
    return true;
  }
}

/**
 * /api/v1/billing — plans, subscription, checkout, order poll (S5-B1).
 *
 * All endpoints are EMPLOYER-only. Approval is enforced where it matters
 * (checkout); plans/subscription are readable pre-approval so the pricing
 * page works for a pending company.
 */
@Controller('billing')
export class BillingController {
  constructor(private readonly checkoutService: CheckoutService) {}

  private assertEmployer(role: UserRole): void {
    if (role !== UserRole.EMPLOYER) {
      throw new ForbiddenException({ code: 'NOT_EMPLOYER' });
    }
  }

  @Get('plans')
  async getPlans(@CurrentUser() user: CurrentUserPayload): Promise<{ data: BillingPlanDto[] }> {
    this.assertEmployer(user.role);
    return { data: await this.checkoutService.getPlans() };
  }

  @Get('subscription')
  async getSubscription(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: SubscriptionStatusDto }> {
    this.assertEmployer(user.role);
    return { data: await this.checkoutService.getSubscription(user.userId) };
  }

  /**
   * S7-B1: the S5 contract's invoices list, implemented at last (found
   * missing while wiring the pdfKey population it exists to serve). `pdfUrl`
   * presigns fresh per read; null until the worker renders.
   */
  @Get('invoices')
  async listInvoices(
    @CurrentUser() user: CurrentUserPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sort') sort?: string,
  ): Promise<{
    data: InvoiceDto[];
    meta: { page: number; pageSize: number; total: number; totalPages: number; sort: string };
  }> {
    this.assertEmployer(user.role);
    const p = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(pageSize ?? '20', 10) || 20));
    // `sort` is passed RAW — the service resolves it against INVOICE_SORT, so
    // an arbitrary column name can never reach Prisma.
    return this.checkoutService.listInvoices(user.userId, p, size, sort);
  }

  /**
   * The checkout request carries `{ planCode }` ONLY. The route-level pipe
   * sets `forbidNonWhitelisted` so a smuggled gateway/amount field is
   * REJECTED with 400 — the whitelist is a security control (routing and
   * money are exclusively server-side).
   */
  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CheckoutBodyGuard)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationProblemFactory,
    }),
  )
  async checkout(
    @Body() dto: CheckoutDto,
    @CurrentUser() user: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ data: CheckoutSessionDto }> {
    this.assertEmployer(user.role);
    const data = await this.checkoutService.checkout(
      user.userId,
      dto.planCode,
      idempotencyKey,
      user.role,
    );
    return { data };
  }

  /**
   * The poll target — safe to poll, never mutates. Until S5-B2's webhooks
   * exist every order remains CREATED, which is correct: activation is
   * webhook-only and nothing in B1 can flip an order.
   */
  @Get('orders/:id')
  async getOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: OrderDto }> {
    this.assertEmployer(user.role);
    return { data: await this.checkoutService.getOrder(user.userId, id) };
  }
}
