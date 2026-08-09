/**
 * THROWAWAY DIAGNOSTIC — verify Titan SMTP credentials outside the app.
 *
 * Uses plain Nodemailer directly (NOT the app's EmailChannel/adapter). It reads
 * the same TITAN_SMTP_* / EMAIL_FROM values the real adapter reads, builds a
 * transport the same way (secure for 465, STARTTLS for 587), runs
 * transporter.verify() to check connection+auth, then sends ONE real email to
 * the recipient you pass on the command line.
 *
 *   node scripts/test-titan-email.js you@yourinbox.com
 *
 * Notes:
 *  - No dotenv dependency (it isn't installed): the .env is parsed inline below.
 *  - nodemailer isn't hoisted to the repo root, so it's resolved from
 *    apps/api/node_modules (where it's a real dependency).
 *  - The raw SMTP error (code + response) is printed on failure — nothing is
 *    swallowed; that's the whole point of the script.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// nodemailer lives in apps/api's node_modules (workspace dep), not the root.
const apiRequire = createRequire(path.join(__dirname, '..', 'apps', 'api', 'package.json'));
let nodemailer;
try {
  nodemailer = apiRequire('nodemailer');
} catch (err) {
  console.error('❌ Could not load nodemailer from apps/api/node_modules.');
  console.error('   Run `pnpm install` first. Original error:', err.message);
  process.exit(1);
}

// ── Tiny .env reader (no dotenv). Reads the repo-root .env; a real process.env
//    value wins so you can override on the command line if you want. ──────────
function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const rootEnv = readEnvFile(path.join(__dirname, '..', '.env'));
const val = (key) => process.env[key] ?? rootEnv[key];

// ── Args ─────────────────────────────────────────────────────────────────────
const recipient = process.argv[2];
if (!recipient || !recipient.includes('@')) {
  console.error('Usage: node scripts/test-titan-email.js <recipient@example.com>');
  console.error('  Sends ONE real test email using your TITAN_SMTP_* / EMAIL_FROM from .env.');
  process.exit(1);
}

// ── Config (mirrors apps/api/.../titan-smtp-email.channel.ts) ────────────────
const host = val('TITAN_SMTP_HOST');
const port = Number(val('TITAN_SMTP_PORT') ?? 465);
const user = val('TITAN_SMTP_USER');
const pass = val('TITAN_SMTP_PASS');
const from = val('EMAIL_FROM');

const missing = [
  ['TITAN_SMTP_HOST', host],
  ['TITAN_SMTP_USER', user],
  ['TITAN_SMTP_PASS', pass],
  ['EMAIL_FROM', from],
]
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length) {
  console.error('❌ Missing required values in .env: ' + missing.join(', '));
  process.exit(1);
}

// 465 = implicit TLS (secure). 587 = STARTTLS (secure:false + requireTLS).
const secure = port === 465;

console.log('─────────────────────────────────────────────');
console.log(' Titan SMTP diagnostic');
console.log('─────────────────────────────────────────────');
console.log(`  host        : ${host}`);
console.log(`  port        : ${port}  (${secure ? 'implicit TLS' : 'STARTTLS'})`);
console.log(`  user        : ${user}`);
console.log(`  from        : ${from}`);
console.log(`  password    : ${'*'.repeat(Math.min(String(pass).length, 12))} (${String(pass).length} chars)`);
console.log(`  send test to: ${recipient}`);
console.log('─────────────────────────────────────────────\n');

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  requireTLS: !secure, // force STARTTLS on 587 — never send credentials in clear
  auth: { user, pass },
  // Surface the SMTP conversation so a failure is diagnosable.
  logger: true,
  debug: true,
});

function dumpError(err) {
  console.error('\n❌ RAW ERROR (nothing swallowed):');
  console.error('  message   :', err && err.message);
  if (err && err.code) console.error('  code      :', err.code); // e.g. EAUTH, ECONNECTION, ETIMEDOUT
  if (err && err.responseCode) console.error('  responseCode:', err.responseCode); // SMTP numeric code
  if (err && err.response) console.error('  response  :', err.response); // raw SMTP server text
  if (err && err.command) console.error('  command   :', err.command);
  console.error('\n  Full error object:');
  console.error(err);
}

(async () => {
  // ── Step 1: verify() — connection + auth, BEFORE sending ───────────────────
  console.log('① Verifying SMTP connection + auth (transporter.verify)…\n');
  try {
    await transporter.verify();
    console.log('\n✅ VERIFY OK — host/port reachable and credentials accepted.\n');
  } catch (err) {
    console.error('\n❌ VERIFY FAILED — bad host/port/credentials or TLS mismatch.');
    dumpError(err);
    console.error('\n════════════ RESULT: ❌ FAILED (verify) ════════════');
    process.exit(2);
  }

  // ── Step 2: send ONE real email ────────────────────────────────────────────
  console.log('② Sending one real test email…\n');
  try {
    const info = await transporter.sendMail({
      from,
      to: recipient,
      subject: 'Skill India Connect — Titan SMTP test ✔',
      text: `This is a plain-text test email sent directly via Nodemailer + Titan SMTP at ${new Date().toISOString()}.`,
      html: `<p>This is a <strong>test email</strong> sent directly via Nodemailer + Titan SMTP.</p><p>Sent at ${new Date().toISOString()}.</p>`,
    });

    console.log('\n✅ SEND ACCEPTED FOR RELAY.');
    console.log('  messageId :', info.messageId);
    if (info.response) console.log('  response  :', info.response);
    if (info.accepted && info.accepted.length) console.log('  accepted  :', info.accepted);
    if (info.rejected && info.rejected.length) console.log('  rejected  :', info.rejected);
    console.log('\n════════════ RESULT: ✅ SUCCESS ════════════');
    console.log('   (Check the inbox — and the SPAM folder — for arrival.)');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ SEND FAILED.');
    dumpError(err);
    console.error('\n════════════ RESULT: ❌ FAILED (send) ════════════');
    process.exit(3);
  } finally {
    transporter.close();
  }
})();
