# Resume template previews — GENERATED ARTIFACTS

These four images are what the template gallery shows the candidate. They are
**rendered from the real server templates**, not drawn by hand.

## ⚠️ A template change requires regenerating its image

If you edit `apps/api/src/resume/templates/*.template.ts` and do not regenerate
the matching image here, **the gallery advertises a layout the PDF no longer
produces**. Nothing fails, no test goes red — the candidate simply picks the
resume they saw and receives a different one. That is the only way this
directory can be wrong, so it is the thing to watch for.

## Regenerating

1. Render the templates to HTML with a realistic profile. The API test suite has
   the fixtures; the quickest route is a temporary spec under
   `apps/api/src/resume/templates/` that walks `TEMPLATE_REGISTRY`, calls each
   renderer with `toResumeView(<realistic source>, settings, null)`, and writes
   the HTML to disk. Delete the spec afterwards — it is a generator, not a test.

2. Screenshot each at A4 (794×1123 at 96dpi) and save as JPEG q82:

   ```js
   import { chromium } from '@playwright/test';
   const page = await (await chromium.launch()).newPage({
     viewport: { width: 794, height: 1123 },
   });
   await page.setContent(html, { waitUntil: 'load' });
   await page.screenshot({ path: 'classic.jpg', type: 'jpeg', quality: 82 });
   ```

## Why JPEG and not WebP

Playwright's screenshot encoder emits PNG or JPEG only, and adding an image
library purely to transcode four static files is not worth the dependency.
`next/image` converts these to WebP on the fly in production and emits a
responsive srcset, so the bytes actually sent to a phone are smaller than the
files committed here. ~50 KB each at rest.

## Use a REALISTIC profile

Generate from a plausible blue-collar candidate — several roles, real-looking
company names, a normal number of skills. Lorem ipsum makes every template look
identical, which defeats the point of showing them: the candidate is choosing
between layouts, and layouts only differ once there is real content in them.
