import { ServiceUnavailableException } from '@nestjs/common';
import { CompanyType, Gateway } from '@prisma/client';
import { SettingsService } from '../settings/settings.service';
import { PaymentGatewayPort } from './gateways/payment-gateway.interface';
import { RoutingService } from './routing.service';

/**
 * The four routing outcomes + the settings-flag flip + the 503 path. Pure DI —
 * fake ports (isConfigured only matters here) and a fake SettingsService.
 */

function port(isConfigured: boolean): PaymentGatewayPort {
  return {
    isConfigured,
    createOrder: jest.fn(),
    verifyWebhook: jest.fn(),
    parseEvent: jest.fn(),
  };
}

function settingsWith(stripeEnabled: boolean): SettingsService {
  return { get: jest.fn().mockResolvedValue(stripeEnabled) } as unknown as SettingsService;
}

describe('RoutingService.resolveGateway — sealed server-side', () => {
  it('LOCAL → Razorpay DOMESTIC (regardless of the stripe flag)', async () => {
    const svc = new RoutingService(settingsWith(true), port(true), port(true));
    await expect(svc.resolveGateway(CompanyType.LOCAL)).resolves.toEqual({
      gateway: Gateway.RAZORPAY,
      mode: 'DOMESTIC',
    });
  });

  it('FOREIGN + stripe flag OFF → Razorpay INTERNATIONAL (the locked primary)', async () => {
    const svc = new RoutingService(settingsWith(false), port(true), port(true));
    await expect(svc.resolveGateway(CompanyType.FOREIGN)).resolves.toEqual({
      gateway: Gateway.RAZORPAY,
      mode: 'INTERNATIONAL',
    });
  });

  it('FOREIGN + stripe flag ON + key configured → STRIPE', async () => {
    const svc = new RoutingService(settingsWith(true), port(true), port(true));
    await expect(svc.resolveGateway(CompanyType.FOREIGN)).resolves.toEqual({
      gateway: Gateway.STRIPE,
    });
  });

  it('FOREIGN + stripe flag ON but key NOT configured → Razorpay INTERNATIONAL (required-at-routing)', async () => {
    const svc = new RoutingService(settingsWith(true), port(true), port(false));
    await expect(svc.resolveGateway(CompanyType.FOREIGN)).resolves.toEqual({
      gateway: Gateway.RAZORPAY,
      mode: 'INTERNATIONAL',
    });
  });

  it('the settings-flag FLIP: enable → stripe; disable → back to razorpay-intl (no restart)', async () => {
    // One mutable settings source — the flag is read per-request, so flipping
    // the platform setting re-routes the very next checkout.
    let enabled = false;
    const settings = {
      get: jest.fn().mockImplementation(async () => enabled),
    } as unknown as SettingsService;
    const svc = new RoutingService(settings, port(true), port(true));

    await expect(svc.resolveGateway(CompanyType.FOREIGN)).resolves.toMatchObject({
      gateway: Gateway.RAZORPAY,
    });
    enabled = true;
    await expect(svc.resolveGateway(CompanyType.FOREIGN)).resolves.toEqual({
      gateway: Gateway.STRIPE,
    });
    enabled = false;
    await expect(svc.resolveGateway(CompanyType.FOREIGN)).resolves.toEqual({
      gateway: Gateway.RAZORPAY,
      mode: 'INTERNATIONAL',
    });
  });

  it('FOREIGN + neither gateway viable → 503 GATEWAY_UNAVAILABLE (the honest failure)', async () => {
    const svc = new RoutingService(settingsWith(false), port(false), port(false));
    await expect(svc.resolveGateway(CompanyType.FOREIGN)).rejects.toMatchObject({
      constructor: ServiceUnavailableException,
      response: { code: 'GATEWAY_UNAVAILABLE' },
    });
  });

  it('LOCAL + razorpay unconfigured → 503 (never a silent wrong-gateway fallback)', async () => {
    const svc = new RoutingService(settingsWith(true), port(false), port(true));
    await expect(svc.resolveGateway(CompanyType.LOCAL)).rejects.toMatchObject({
      response: { code: 'GATEWAY_UNAVAILABLE' },
    });
  });
});
