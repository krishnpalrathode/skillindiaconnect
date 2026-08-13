import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale } from './locales';
import englishMessages from './messages/en.json';

type MessageNode = string | MessageTree | MessageNode[];
type MessageTree = { [key: string]: MessageNode };

/**
 * Overlay a locale's catalog on top of English, key by key.
 *
 * This is the piece that makes a partially-translated language SAFE to ship.
 * Without it next-intl raises `IntlError: MISSING_MESSAGE` for any key the
 * locale lacks — which was not hypothetical: `hi` and `ar` were each missing all
 * 675 `admin.*` keys, so the admin console threw on every render in those
 * languages. A missing translation should degrade to English, which every
 * operator here reads, not to an error.
 *
 * It also changes the economics of adding a language. A new locale can land with
 * its highest-traffic screens translated and grow over time, instead of needing
 * ~2,200 strings before it can be turned on at all.
 *
 * Merged rather than resolved at lookup time because next-intl validates the
 * whole tree up front; handing it a complete tree keeps every key resolvable and
 * every ICU argument intact.
 */
function mergeNode(base: MessageNode, override: MessageNode): MessageNode {
  /*
    Arrays are merged BY INDEX and re-emitted as arrays. `staticPages.*.sections`
    is a list of {heading, body} blocks, and spreading one into an object literal
    would hand next-intl `{0: …, 1: …}` — the privacy and terms pages render
    those by index, so they would come back empty. A locale that has translated
    the first three of five sections keeps English for the last two, which is the
    same per-key degradation applied to a list.
  */
  if (Array.isArray(base) && Array.isArray(override)) {
    return base.map((item, i) => (i < override.length ? mergeNode(item, override[i]!) : item));
  }
  if (isTree(base) && isTree(override)) {
    const out: MessageTree = { ...base };
    for (const [key, value] of Object.entries(override)) {
      out[key] = key in base ? mergeNode(base[key]!, value) : value;
    }
    return out;
  }
  // Empty strings count as "not translated yet" rather than as a deliberate
  // blank label, so a stubbed-out entry shows English instead of an invisible
  // control. Anything else structurally mismatched keeps English.
  if (typeof override === 'string') return override.trim() === '' ? base : override;
  return base;
}

function isTree(value: MessageNode): value is MessageTree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeOverEnglish(base: MessageTree, override: MessageTree): MessageTree {
  return mergeNode(base, override) as MessageTree;
}

async function loadMessages(locale: string): Promise<MessageTree> {
  if (locale === DEFAULT_LOCALE) return englishMessages as MessageTree;
  try {
    const mod = (await import(`./messages/${locale}.json`)) as { default: MessageTree };
    return mergeOverEnglish(englishMessages as MessageTree, mod.default);
  } catch {
    // A registered locale whose catalog file hasn't landed yet renders entirely
    // in English rather than 500-ing the route.
    return englishMessages as MessageTree;
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;

  return {
    locale,
    messages: await loadMessages(locale),
    /*
      Last line of defence. The merge above should make this unreachable — every
      key exists in English by construction — but a key absent from en.json too
      would otherwise throw during render. Showing the key path degrades one
      label; throwing takes down the page.
    */
    getMessageFallback: ({ key, namespace }) => (namespace ? `${namespace}.${key}` : key),
  };
});
