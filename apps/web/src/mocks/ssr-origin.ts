// Arbitrary loopback origin used ONLY to give MSW's Node server an absolute
// URL to match handler patterns against during SSR. No real server listens on
// this port — msw/node's setupServer() intercepts the request before any real
// network call happens. Verified empirically: MSW v2.14.6's Node interceptor
// matches a handler pattern against the FULL request URL, so a relative
// pattern ('/api/v1/jobs') never matches an absolute fetch() call (Node's
// fetch has no implicit origin to resolve a relative pattern against — there
// is no `location` global). An absolute pattern matches an absolute fetch
// only when the origins are byte-identical, hence this single shared constant.
export const MOCK_SSR_ORIGIN = 'http://127.0.0.1:4399';
