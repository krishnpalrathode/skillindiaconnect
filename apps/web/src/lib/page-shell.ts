/**
 * The candidate app's ONE page container.
 *
 * Every screen under app/[locale]/(app) had rolled its own wrapper — five
 * different max-widths (2xl/3xl/4xl/6xl) and four different padding sets — so
 * moving between Dashboard, Profile and Resume Builder visibly shifted the
 * content's left and right edges. The Dashboard's container is the reference;
 * this is that exact string, in one place, so the next new page inherits it
 * instead of inventing a sixth width.
 *
 * Pages that genuinely need a narrower READING column should constrain their
 * own content inside this shell rather than shrinking the shell — the frame
 * staying put is what makes the app feel like one product.
 */
export const PAGE_SHELL =
  'mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:gap-7 lg:px-8 lg:py-8';

/**
 * The employer console's page container.
 *
 * Same width and rhythm as PAGE_SHELL, but WITHOUT padding: the employer layout
 * already pads its <main> (`p-4 sm:p-6 lg:p-8`), so repeating it here would
 * double the gutters. Employer pages had drifted the same way the candidate
 * ones did — 6xl on Dashboard and My Jobs, 5xl on Subscription, 4xl on Company
 * Profile, 2xl on Notifications — so the content edge moved as you switched
 * tabs. The Dashboard is the reference.
 */
export const EMPLOYER_PAGE_SHELL = 'mx-auto flex w-full max-w-6xl flex-col gap-6 lg:gap-7';
