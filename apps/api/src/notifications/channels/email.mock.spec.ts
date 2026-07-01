import { MOCK_BOUNCE_EMAIL, MOCK_FAIL_EMAIL, MockEmailChannel } from './email.mock';

describe('MockEmailChannel', () => {
  let channel: MockEmailChannel;

  beforeEach(() => {
    channel = new MockEmailChannel();
  });

  it('returns ok:true with a providerMessageId for a normal address', async () => {
    const result = await channel.send('user@example.com', 'APPLICATION_SELECTED', {});
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toMatch(/^mock-email-/);
  });

  it('returns ok:false, bounced:true for MOCK_BOUNCE_EMAIL', async () => {
    const result = await channel.send(MOCK_BOUNCE_EMAIL, 'APPLICATION_SELECTED', {});
    expect(result.ok).toBe(false);
    expect(result.bounced).toBe(true);
    expect(result.providerMessageId).toBeUndefined();
  });

  it('returns ok:false, errorCode for MOCK_FAIL_EMAIL', async () => {
    const result = await channel.send(MOCK_FAIL_EMAIL, 'APPLICATION_SELECTED', {});
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('MOCK_SEND_ERROR');
    expect(result.bounced).toBeUndefined();
  });

  it('getSentEmails records successful sends', async () => {
    await channel.send('a@b.com', 'APPLICATION_SELECTED', {});
    await channel.send('c@d.com', 'APPLICATION_REJECTED', {});
    expect(channel.getSentEmails()).toHaveLength(2);
  });

  it('clearSentEmails resets the log', async () => {
    await channel.send('a@b.com', 'APPLICATION_SELECTED', {});
    channel.clearSentEmails();
    expect(channel.getSentEmails()).toHaveLength(0);
  });

  it('bounce address is not recorded in getSentEmails', async () => {
    await channel.send(MOCK_BOUNCE_EMAIL, 'APPLICATION_SELECTED', {});
    expect(channel.getSentEmails()).toHaveLength(0);
  });
});

describe('MockWhatsappChannel — sendTemplate (unit)', () => {
  it('sendTemplate returns ok:true with providerMessageId for normal phone', async () => {
    // Inline test — avoids importing the mock module twice
    const { MockWhatsappChannel } = jest.requireActual<
      typeof import('./whatsapp.mock')
    >('./whatsapp.mock');
    const wa = new MockWhatsappChannel();
    const result = await wa.sendTemplate('+919876543210', 'wa.selected', { name: 'Alice' });
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toMatch(/^mock-tpl-/);
  });

  it('sendTemplate returns ok:false, notOnWhatsapp:true for 0000-suffix phone', async () => {
    const { MockWhatsappChannel } = jest.requireActual<
      typeof import('./whatsapp.mock')
    >('./whatsapp.mock');
    const wa = new MockWhatsappChannel();
    const result = await wa.sendTemplate('+919876540000', 'wa.selected', {});
    expect(result.ok).toBe(false);
    expect(result.notOnWhatsapp).toBe(true);
  });

  it('sendOtp and sendTemplate are tracked independently', async () => {
    const { MockWhatsappChannel } = jest.requireActual<
      typeof import('./whatsapp.mock')
    >('./whatsapp.mock');
    const wa = new MockWhatsappChannel();
    await wa.sendOtp('+919876543210', '123456', 'LOGIN');
    await wa.sendTemplate('+919876543210', 'wa.selected', {});
    expect(wa.getLastSentCode('+919876543210')).toBe('123456');
    expect(wa.getLastTemplateMessageId('+919876543210', 'wa.selected')).toMatch(/^mock-tpl-/);
  });
});
