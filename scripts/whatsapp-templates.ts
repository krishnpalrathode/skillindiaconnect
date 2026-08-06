/**
 * WhatsApp template diagnostic — asks Meta what actually exists.
 *
 * Standalone and READ-ONLY. It imports nothing from apps/ or packages/, touches
 * no application code, and issues only GETs. It never prints the access token.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────────
 *
 * Error 132001 — "Template name does not exist in the translation" — is returned
 * for at least four different situations, and its text only ever describes the
 * first:
 *
 *   1. the name is right but the LOCALE is wrong (en / en_US / en_GB / …),
 *   2. the NAME differs — a typo, or a rename in WhatsApp Manager,
 *   3. the template exists but is NOT APPROVED (a PENDING template answers
 *      132001 exactly like a missing one),
 *   4. the template lives in a DIFFERENT WABA from the phone number sending it.
 *
 * Guessing between those costs a deploy each time. This prints the answer.
 *
 * ── HOW IT FINDS THE WABA ─────────────────────────────────────────────────────
 *
 * There is NO documented field on a phone-number node pointing at its parent
 * WhatsApp Business Account, so the id cannot simply be read off it. Candidates
 * are discovered from the token (its granular scopes are WABA-scoped) and from
 * the businesses it can see — and then every candidate is VERIFIED by checking
 * that WHATSAPP_PHONE_NUMBER_ID actually appears in that WABA's phone_numbers
 * edge. Discovery being undocumented therefore cannot produce a wrong answer:
 * an id that does not own the number is rejected.
 *
 * ── RUN ───────────────────────────────────────────────────────────────────────
 *
 *   WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... pnpm whatsapp:templates
 *
 * Optional: WHATSAPP_WABA_ID (skips discovery), WHATSAPP_GRAPH_VERSION.
 */

const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const GRAPH = process.env.WHATSAPP_GRAPH_VERSION ?? 'v21.0';
const EXPLICIT_WABA = process.env.WHATSAPP_WABA_ID;

/**
 * The names this codebase sends. Source of truth is
 * apps/api/src/notifications/channels/meta-templates.ts — a literal here so the
 * script stays standalone (importing it drags in Prisma via the notification
 * matrix). Every template Meta returns is printed regardless, so drift between
 * the two is visible rather than hidden.
 */
const EXPECTED = ['login_otp', 'job_selected', 'resume_generated'];
const PRIMARY = 'login_otp';

interface Template {
  name: string;
  language: string;
  status: string;
  category?: string;
}
interface GraphError {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
}

const base = `https://graph.facebook.com/${GRAPH}`;
let failed = false;

async function get<T>(path: string): Promise<{ data: T | null; error: GraphError | null; status: number }> {
  try {
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${TOKEN!}` } });
    const body = (await res.json().catch(() => null)) as (T & { error?: GraphError }) | null;
    if (!res.ok) return { data: null, error: body?.error ?? { message: `HTTP ${res.status}` }, status: res.status };
    return { data: body as T, error: null, status: res.status };
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) }, status: 0 };
  }
}

const pad = (s: string, n: number) => String(s).padEnd(n);
const line = (n = 74) => '─'.repeat(n);

// ── 1. Preconditions ─────────────────────────────────────────────────────────

function requireEnv(): void {
  const missing: string[] = [];
  if (!TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!PHONE_NUMBER_ID) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (missing.length === 0) return;

  console.error(`\n✗ Missing: ${missing.join(', ')}\n`);
  console.error('Use the SAME values the API service runs with:\n');
  console.error('  WHATSAPP_ACCESS_TOKEN=EAA... \\');
  console.error('  WHATSAPP_PHONE_NUMBER_ID=123456789 \\');
  console.error('    pnpm whatsapp:templates\n');
  process.exit(2);
}

// ── 2. Identify the phone number ─────────────────────────────────────────────

async function describePhoneNumber(): Promise<boolean> {
  const { data, error, status } = await get<{
    id: string;
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    code_verification_status?: string;
  }>(`/${PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`);

  if (!data) {
    console.error(`✗ Cannot read the phone number (HTTP ${status}).`);
    console.error(`    code=${error?.code ?? 'none'} message=${error?.message ?? 'unknown'}`);
    if (status === 401 || status === 403 || error?.code === 190) {
      console.error('\n  → The TOKEN is invalid or expired. If it is a 24-hour tester token,');
      console.error('    that is the whole problem; generate a System User token.');
    } else if (error?.code === 100) {
      console.error('\n  → WHATSAPP_PHONE_NUMBER_ID is not a phone-number id.');
      console.error('    In WhatsApp Manager it is the "Phone number ID", NOT the phone number');
      console.error('    itself and NOT the WhatsApp Business Account ID.');
    }
    return false;
  }

  console.log(`  id                 ${data.id}`);
  console.log(`  number             ${data.display_phone_number ?? '(not shown)'}`);
  console.log(`  verified name      ${data.verified_name ?? '(none)'}`);
  console.log(`  quality            ${data.quality_rating ?? '(n/a)'}`);
  console.log(`  verification       ${data.code_verification_status ?? '(n/a)'}`);
  return true;
}

// ── 3. Discover candidate WABAs, then VERIFY which owns the number ───────────

async function candidateWabas(): Promise<{ id: string; source: string }[]> {
  const out: { id: string; source: string }[] = [];
  const seen = new Set<string>();
  const add = (id: unknown, source: string) => {
    const s = String(id);
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push({ id: s, source });
  };

  if (EXPLICIT_WABA) add(EXPLICIT_WABA, 'WHATSAPP_WABA_ID env');

  // The token's granular scopes are WABA-scoped. Undocumented as "these are
  // WABA ids", which is exactly why every candidate is verified below.
  const dbg = await get<{
    data?: { granular_scopes?: { scope: string; target_ids?: (string | number)[] }[] };
  }>(`/debug_token?input_token=${encodeURIComponent(TOKEN!)}&access_token=${encodeURIComponent(TOKEN!)}`);
  for (const g of dbg.data?.data?.granular_scopes ?? []) {
    if (!g.scope.startsWith('whatsapp_business')) continue;
    for (const t of g.target_ids ?? []) add(t, `token scope ${g.scope}`);
  }

  // Businesses the token can see → the WABAs they own or are clients of.
  const biz = await get<{ data?: { id: string; name?: string }[] }>('/me/businesses?limit=50');
  for (const b of biz.data?.data ?? []) {
    for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      const w = await get<{ data?: { id: string }[] }>(`/${b.id}/${edge}?limit=50`);
      for (const acct of w.data?.data ?? []) add(acct.id, `business ${b.name ?? b.id}`);
    }
  }

  return out;
}

async function ownsNumber(waba: string): Promise<boolean> {
  const { data } = await get<{ data?: { id: string }[] }>(`/${waba}/phone_numbers?limit=100`);
  return (data?.data ?? []).some((p) => String(p.id) === String(PHONE_NUMBER_ID));
}

// ── 4. Templates ─────────────────────────────────────────────────────────────

async function listTemplates(waba: string): Promise<Template[] | null> {
  const { data, error, status } = await get<{ data?: Template[] }>(
    `/${waba}/message_templates?fields=name,language,status,category&limit=200`,
  );
  if (!data) {
    console.error(`  ✗ Cannot list templates (HTTP ${status}) code=${error?.code ?? 'none'} ${error?.message ?? ''}`);
    if (status === 403 || error?.code === 200) {
      console.error('    → The token likely lacks the whatsapp_business_management permission.');
    }
    return null;
  }
  return data.data ?? [];
}

function report(templates: Template[], waba: string): void {
  console.log(`\n▸ TEMPLATES ON WABA ${waba}\n`);

  if (templates.length === 0) {
    failed = true;
    console.log('  ✗ ZERO templates on this WABA.\n');
    console.log('    This WABA genuinely owns your phone number, so the templates you');
    console.log('    created were created SOMEWHERE ELSE — a different WhatsApp Business');
    console.log('    Account, or a different Meta app/business entirely.');
    console.log('');
    console.log('    Sending can only use templates on the WABA that owns the number.');
    console.log('    Either recreate them on this WABA, or point');
    console.log('    WHATSAPP_PHONE_NUMBER_ID at a number belonging to the WABA that');
    console.log('    already has them.');
    return;
  }

  console.log(`  ${pad('NAME', 30)}${pad('LANGUAGE', 12)}${pad('STATUS', 12)}CATEGORY`);
  console.log(`  ${line()}`);
  for (const t of [...templates].sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${pad(t.name, 30)}${pad(t.language, 12)}${pad(t.status, 12)}${t.category ?? ''}`);
  }

  // ── login_otp specifically ────────────────────────────────────────────────
  console.log(`\n▸ ${PRIMARY} (the login/verification template)\n`);
  const otp = templates.filter((t) => t.name === PRIMARY);

  if (otp.length === 0) {
    failed = true;
    console.log(`  ✗ NOT FOUND under any locale.\n`);
    // A rename or a typo is invisible from the send error, so surface anything close.
    const similar = templates.filter((t) => {
      const n = t.name.toLowerCase();
      return n.includes('otp') || n.includes('login') || n.includes('auth') || n.includes('verif') || n.includes('code');
    });
    if (similar.length > 0) {
      console.log('    Similar names present — is one of these the real name?');
      for (const s of [...new Set(similar.map((t) => t.name))]) {
        const locales = similar.filter((t) => t.name === s).map((t) => `${t.language}/${t.status}`);
        console.log(`      • ${pad(s, 30)} ${locales.join(', ')}`);
      }
      console.log(`\n    If so, update META_TEMPLATES in`);
      console.log(`    apps/api/src/notifications/channels/meta-templates.ts`);
    } else {
      console.log(`    Nothing resembling an OTP/auth template on this WABA either.`);
      console.log(`    It was never created here, or it was created on another WABA.`);
    }
  } else {
    for (const t of otp) {
      const ok = t.status === 'APPROVED';
      if (!ok) failed = true;
      console.log(`  ${ok ? '✓' : '✗'} language=${pad(t.language, 10)} status=${t.status}  category=${t.category ?? '?'}`);
      if (!ok) {
        // A PENDING template answers 132001 exactly like a missing one.
        console.log(`      → Not APPROVED. Meta rejects sends against it with code 132001,`);
        console.log(`        the SAME error as a template that does not exist.`);
      }
    }
  }

  // ── The setting to apply ──────────────────────────────────────────────────
  console.log(`\n▸ WHAT TO SET\n`);
  const approved = new Map<string, string[]>();
  for (const name of EXPECTED) {
    const hits = templates.filter((t) => t.name === name && t.status === 'APPROVED');
    if (hits.length === 0) {
      failed = true;
      const any = templates.filter((t) => t.name === name);
      console.log(
        `  ✗ ${pad(name, 22)} ${any.length ? `present but ${any.map((a) => a.status).join('/')}` : 'MISSING'}`,
      );
      continue;
    }
    console.log(`  ✓ ${pad(name, 22)} ${hits.map((h) => h.language).join(', ')}`);
    for (const h of hits) approved.set(h.language, [...(approved.get(h.language) ?? []), name]);
  }

  const locales = [...approved.keys()];
  console.log('');
  if (locales.length === 1) {
    console.log(`  Set on BOTH services (Render API + Railway worker), then restart:\n`);
    console.log(`      WHATSAPP_TEMPLATE_LANGUAGE=${locales[0]}\n`);
  } else if (locales.length > 1) {
    console.log(`  Templates span MULTIPLE locales: ${locales.join(', ')}`);
    for (const [loc, names] of approved) console.log(`      ${pad(loc, 10)} ${names.join(', ')}`);
    console.log(`\n  Set WHATSAPP_TEMPLATE_LANGUAGE to the majority locale and override the`);
    console.log(`  odd one via \`language\` on its entry in meta-templates.ts.\n`);
  } else {
    console.log(`  Nothing approved — fix names/approval before touching the locale.\n`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  requireEnv();

  console.log(`\n${line()}`);
  console.log(`WhatsApp template diagnostic — Graph ${GRAPH}`);
  console.log(line());

  console.log(`\n▸ PHONE NUMBER\n`);
  if (!(await describePhoneNumber())) {
    console.log(`\n${line()}\nFAIL — could not read the phone number; nothing else can be trusted.\n`);
    process.exit(1);
  }

  console.log(`\n▸ RESOLVING THE WABA THAT OWNS IT\n`);
  const candidates = await candidateWabas();

  if (candidates.length === 0) {
    console.log('  ✗ No candidate WABAs discoverable from this token.\n');
    console.log('    Supply it directly (WhatsApp Manager → WhatsApp Business Account ID):');
    console.log('      WHATSAPP_WABA_ID=<id> pnpm whatsapp:templates\n');
    console.log(`${line()}\nFAIL — WABA not resolved.\n`);
    process.exit(1);
  }

  let owner: string | null = null;
  const others: string[] = [];
  for (const c of candidates) {
    const owns = await ownsNumber(c.id);
    console.log(`  ${owns ? '✓' : '·'} ${pad(c.id, 22)} ${owns ? 'OWNS this number' : 'does not own it'}   (${c.source})`);
    if (owns && !owner) owner = c.id;
    else if (!owns) others.push(c.id);
  }

  if (!owner) {
    failed = true;
    console.log(`\n  ✗ NONE of the discoverable WABAs owns ${PHONE_NUMBER_ID}.\n`);
    console.log('    The access token and the phone number belong to a DIFFERENT');
    console.log('    WhatsApp Business Account than the one the templates were created');
    console.log('    in. That is exactly the situation error 132001 cannot express:');
    console.log('    the template is real, it is approved, and it is invisible to this');
    console.log('    number because it lives on another WABA.\n');
    console.log('    Listing what those other WABAs DO have, for comparison:');
    for (const w of others) {
      const t = await listTemplates(w);
      if (t) console.log(`      ${pad(w, 22)} ${t.length} template(s): ${[...new Set(t.map((x) => x.name))].join(', ') || '(none)'}`);
    }
    console.log(`\n${line()}\nFAIL — phone number and templates are on different WABAs.\n`);
    process.exit(1);
  }

  const templates = await listTemplates(owner);
  if (templates === null) {
    console.log(`\n${line()}\nFAIL — could not list templates.\n`);
    process.exit(1);
  }

  report(templates, owner);

  // Templates elsewhere are the tell for "created on the wrong WABA".
  if (templates.length === 0 && others.length > 0) {
    console.log('  For comparison, the other WABAs this token can see:');
    for (const w of others) {
      const t = await listTemplates(w);
      if (t && t.length > 0) {
        console.log(`      ${pad(w, 22)} ${t.length} template(s): ${[...new Set(t.map((x) => x.name))].join(', ')}`);
        console.log(`      → Your templates are HERE, not on the WABA that owns the number.`);
      }
    }
    console.log('');
  }

  console.log(line());
  console.log(failed ? 'FAIL — see the ✗ lines above.' : 'PASS — every expected template is APPROVED and reachable.');
  console.log(`${line()}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('\nUnexpected failure:', err instanceof Error ? err.message : err);
  process.exit(1);
});
