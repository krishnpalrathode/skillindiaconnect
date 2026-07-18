// Global CSS imports are processed by Next.js webpack at build time.
// This declaration prevents TypeScript's side-effect import check (TS2882).
declare module '*.css' {}

// Declaring these as real properties (rather than leaning on ProcessEnv's index
// signature) is what lets us read them with DOT access. That matters: webpack's
// DefinePlugin only inlines `process.env.FOO`, never `process.env['FOO']`.
// Bracket access survives into the browser bundle as a lookup on Next's empty
// `process` shim and is therefore ALWAYS undefined on the client — read these
// with dot access only.
declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_API_URL?: string;
    NEXT_PUBLIC_API_MOCKING?: string;
    NEXT_RUNTIME?: string;
  }
}
