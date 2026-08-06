/**
 * List the WhatsApp templates Meta ACTUALLY has, with their real locales.
 *
 * WHY THIS EXISTS. Error 132001 — "Template name does not exist in the
 * translation" — is returned for at least four different situations, and its
 * text only ever describes the first:
 *
 *   1. the name is right but the LOCALE is wrong (en vs en_US vs en_GB),
 *   2. the name itself differs (a typo, or a rename in WhatsApp Manager),
 *   3. the template exists but is NOT APPROVED (pending / rejected / paused),
 *   4. the template lives in a DIFFERENT WABA from the phone number sending it.
 *
 * Guessing between those costs a deploy each time. This asks Meta and prints the
 * answer, so the next change is the last one.
 *
 * Usage (values you already have in your deployment env):
 *
 *   WHATSAPP_ACCESS_TOKEN=EAA... WHATSAPP_WABA_ID=123... pnpm tsx scripts/whatsapp-templates.ts
 *
 * WHATSAPP_WABA_ID is the "WhatsApp Business Account ID" in WhatsApp Manager —
 * NOT the phone number ID. The Cloud API does not expose the parent WABA from a
 * phone number node, so it has to be supplied.
 *
 * Read-only: a single GET against the message_templates edge. Prints no token.
 */

/**
 * The names this codebase sends. Source of truth is
 * apps/api/src/notifications/channels/meta-templates.ts — kept as a literal here
 * so the script stays standalone (importing it drags in Prisma via the
 * notification matrix). Every template Meta returns is printed regardless, so a
 * drift between the two is visible rather than hidden.
 */
const EXPECTED = ['login_otp', 'job_selected', 'resume_generated'];

interface TemplateNode {
  name: string;
  language: string;
  status: string;
  category?: string;
}

async function main(): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const waba = process.env.WHATSAPP_WABA_ID;
  const version = process.env.WHATSAPP_GRAPH_VERSION ?? 'v21.0';

  if (!token || !waba) {
    console.error(
      'Missing config.\n' +
        '  WHATSAPP_ACCESS_TOKEN — the same System User token the API uses\n' +
        '  WHATSAPP_WABA_ID      — WhatsApp Manager → WhatsApp Business Account ID\n' +
        '                          (NOT the phone number ID)\n\n' +
        'Example:\n' +
        '  WHATSAPP_ACCESS_TOKEN=EAA... WHATSAPP_WABA_ID=123... \\\n' +
        '    pnpm tsx scripts/whatsapp-templates.ts',
    );
    process.exit(2);
  }

  const url =
    `https://graph.facebook.com/${version}/${waba}/message_templates` +
    `?fields=name,language,status,category&limit=200`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => null)) as {
    data?: TemplateNode[];
    error?: { message?: string; code?: number; error_subcode?: number };
  } | null;

  if (!res.ok || !body?.data) {
    // The token or the WABA id is wrong — surfaced plainly, since this is the
    // one place where "I cannot even ask" is itself the finding.
    console.error(`Graph API returned ${res.status}`);
    console.error(`  code=${body?.error?.code ?? 'none'} subcode=${body?.error?.error_subcode ?? 'none'}`);
    console.error(`  message=${body?.error?.message ?? '<no error object>'}`);
    if (res.status === 401 || res.status === 403) {
      console.error('\n→ 401/403 here means the TOKEN is bad or lacks whatsapp_business_management.');
    }
    if (body?.error?.code === 100) {
      console.error('\n→ code 100 usually means WHATSAPP_WABA_ID is not a WABA id (phone number id?).');
    }
    process.exit(1);
  }

  const templates = body.data;
  if (templates.length === 0) {
    console.log('Meta returned ZERO templates for this WABA.');
    console.log('→ Either the WABA id is wrong, or the templates live in a different WABA');
    console.log('  from the one your WHATSAPP_PHONE_NUMBER_ID belongs to.');
    process.exit(1);
  }

  console.log(`\n${templates.length} template(s) on WABA ${waba}:\n`);
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`  ${pad('NAME', 28)}${pad('LANGUAGE', 12)}${pad('STATUS', 12)}CATEGORY`);
  console.log(`  ${'-'.repeat(70)}`);
  for (const t of templates) {
    console.log(
      `  ${pad(t.name, 28)}${pad(t.language, 12)}${pad(t.status, 12)}${t.category ?? ''}`,
    );
  }

  // ── The actionable part ────────────────────────────────────────────────────
  console.log('\nAgainst what this codebase sends:\n');
  const approvedLocales = new Set<string>();
  let allFound = true;

  for (const name of EXPECTED) {
    const matches = templates.filter((t) => t.name === name);
    if (matches.length === 0) {
      allFound = false;
      console.log(`  ✗ ${name} — NOT PRESENT on this WABA under any locale.`);
      const near = templates.filter((t) => t.name.includes(name.split('_')[0]!));
      if (near.length > 0) {
        console.log(`      similar names present: ${[...new Set(near.map((n) => n.name))].join(', ')}`);
      }
      continue;
    }
    for (const m of matches) {
      const ok = m.status === 'APPROVED';
      if (!ok) allFound = false;
      // Status matters as much as locale: a PENDING template answers 132001
      // exactly like a missing one.
      console.log(`  ${ok ? '✓' : '✗'} ${name} — language=${m.language} status=${m.status}`);
      if (ok) approvedLocales.add(m.language);
    }
  }

  console.log('');
  if (approvedLocales.size === 1) {
    const [locale] = [...approvedLocales];
    console.log(`→ Set on BOTH services:  WHATSAPP_TEMPLATE_LANGUAGE=${locale}`);
  } else if (approvedLocales.size > 1) {
    console.log(`→ Templates span MULTIPLE locales: ${[...approvedLocales].join(', ')}`);
    console.log('  Set WHATSAPP_TEMPLATE_LANGUAGE to the majority and override the');
    console.log('  odd one via `language` in meta-templates.ts.');
  } else {
    console.log('→ No APPROVED template matched. Fix the names/approval before the locale.');
  }

  process.exit(allFound ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
