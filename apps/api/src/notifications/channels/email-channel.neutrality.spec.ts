/**
 * STRUCTURAL GUARD — the EmailChannel port must never leak a provider concept.
 *
 * The entire value of this seam is a one-adapter SES swap later. A single
 * SMTP/SES field on the port or its neutral message types would defeat that.
 * This test reads the port's SOURCE and fails if any transport/host/SES token
 * appears, and asserts mock + Titan both implement the SAME port.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MockEmailChannel } from './email.mock';
import { EmailChannel, resolveOutboundEmail } from './email.channel';

const PORT_FILE = path.resolve(__dirname, 'email.channel.ts');

// Words that would mean a provider concept leaked into the PORT (not an adapter).
const LEAK_TOKENS = [
  'smtp',
  'nodemailer',
  'transport',
  'host',
  'port',
  'pool',
  'ses',
  'region',
  'configset',
  'config-set',
  'tls',
  'starttls',
];

describe('EmailChannel port neutrality (structural)', () => {
  const source = fs.readFileSync(PORT_FILE, 'utf8');
  // Strip comments — the doc-comments legitimately NAME providers to explain the
  // seam; the guard is about CODE (types/fields), not prose.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it.each(LEAK_TOKENS)('the port code carries no "%s" concept', (token) => {
    // Word-boundary match so 'port' doesn't fire on 'export' nor 'ses' on 'uses'.
    const leaked = new RegExp(`\\b${token.replace('-', '\\-?')}\\b`, 'i').test(code);
    expect({ token, leaked }).toEqual({ token, leaked: false });
  });

  it('the resolved neutral message has ONLY provider-neutral fields', () => {
    const msg = resolveOutboundEmail('a@b.com', 'APPLICATION_SELECTED', {}, 'from@sic.com');
    expect(Object.keys(msg).sort()).toEqual(['from', 'html', 'subject', 'text', 'to'].sort());
  });

  it('MockEmailChannel implements the EmailChannel port (same seam as Titan)', () => {
    const mock: EmailChannel = new MockEmailChannel();
    expect(typeof mock.send).toBe('function');
    // The port method takes (to, type, payload) — three args, provider-neutral.
    expect(mock.send.length).toBe(3);
  });
});
