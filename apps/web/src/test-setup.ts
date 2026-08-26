import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server';

/*
  jsdom implements no `matchMedia`, and any component that respects
  `prefers-reduced-motion` calls it on mount — so rendering one throws
  "window.matchMedia is not a function" for a reason that has nothing to do
  with what the test is asserting.

  Stubbed globally rather than per file: this is a gap in the environment, not
  a property of one component, and the next motion-aware component to get a
  test should not have to rediscover it.

  It reports `matches: false` — i.e. NO reduced-motion preference — because
  that is the path that actually runs animations and listeners, and is
  therefore the one worth exercising by default. A test about the
  reduced-motion path can override this.
*/
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      // Deprecated pair, still called by older libraries.
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
