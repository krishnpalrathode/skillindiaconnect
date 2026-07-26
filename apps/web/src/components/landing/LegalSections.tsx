export interface LegalSection {
  heading: string;
  body: string;
}

/**
 * Renders a numbered list of legal clauses shared by the Privacy and Terms
 * pages. The `PENDING LEGAL REVIEW` marker is emitted as a real HTML comment
 * (not a JSX comment, which React strips) so it is visible in view-source and
 * in any content export.
 */
export function LegalSections({ sections }: { sections: LegalSection[] }) {
  return (
    <>
      <div
        dangerouslySetInnerHTML={{
          __html: '<!-- PENDING LEGAL REVIEW — do not treat as final -->',
        }}
      />
      <ol className="flex flex-col gap-9">
        {sections.map((s, i) => (
          <li key={s.heading} className="flex gap-4">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-sm font-bold tabular-nums text-primary-700"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-neutral-900">{s.heading}</h2>
              <p className="mt-2 text-base leading-relaxed text-neutral-700">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
