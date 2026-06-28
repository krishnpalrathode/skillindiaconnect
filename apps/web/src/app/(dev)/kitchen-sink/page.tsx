import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Field } from '@/components/ui/field';

/* Guard: dev-only. Not linked from production nav. */
export default function KitchenSinkPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="min-h-screen bg-neutral-50 p-8">
      <div className="mx-auto max-w-4xl space-y-12">
        <header className="border-b border-neutral-200 pb-6">
          <h1 className="text-3xl font-bold text-primary-700">Design System Kitchen Sink</h1>
          <p className="mt-2 text-neutral-600">
            Token + primitive preview — dev only, never linked in production.
          </p>
        </header>

        {/* ── Color Ramps ── */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-neutral-800">Color Ramps</h2>

          <div>
            <p className="mb-2 text-sm font-medium text-neutral-600">Primary (blue)</p>
            <div className="flex gap-1 flex-wrap">
              {(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const).map(
                (shade) => (
                  <div key={shade} className="flex flex-col items-center gap-1">
                    <div
                      className="h-10 w-12 rounded"
                      style={{ backgroundColor: `var(--color-primary-${shade})` }}
                    />
                    <span className="text-[10px] text-neutral-500">{shade}</span>
                  </div>
                ),
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-neutral-600">Accent (orange)</p>
            <div className="flex gap-1 flex-wrap">
              {(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const).map(
                (shade) => (
                  <div key={shade} className="flex flex-col items-center gap-1">
                    <div
                      className="h-10 w-12 rounded"
                      style={{ backgroundColor: `var(--color-accent-${shade})` }}
                    />
                    <span className="text-[10px] text-neutral-500">{shade}</span>
                  </div>
                ),
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-neutral-600">Neutral (warm gray)</p>
            <div className="flex gap-1 flex-wrap">
              {(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const).map(
                (shade) => (
                  <div key={shade} className="flex flex-col items-center gap-1">
                    <div
                      className="h-10 w-12 rounded border border-neutral-200"
                      style={{ backgroundColor: `var(--color-neutral-${shade})` }}
                    />
                    <span className="text-[10px] text-neutral-500">{shade}</span>
                  </div>
                ),
              )}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-neutral-600">Semantic</p>
            <div className="flex gap-3 flex-wrap">
              {[
                { label: 'success', bg: 'var(--color-success-bg)', fg: 'var(--color-success-fg)' },
                { label: 'warning', bg: 'var(--color-warning-bg)', fg: 'var(--color-warning-fg)' },
                { label: 'error', bg: 'var(--color-error-bg)', fg: 'var(--color-error-fg)' },
                { label: 'info', bg: 'var(--color-info-bg)', fg: 'var(--color-info-fg)' },
              ].map(({ label, bg, fg }) => (
                <div
                  key={label}
                  className="rounded px-3 py-1 text-sm font-medium"
                  style={{ backgroundColor: bg, color: fg }}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Typography ── */}
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-neutral-800">Type Scale</h2>
          <div className="space-y-1">
            {[
              { cls: 'text-4xl font-bold', label: '4xl / 36px bold' },
              { cls: 'text-3xl font-semibold', label: '3xl / 30px semibold' },
              { cls: 'text-2xl font-semibold', label: '2xl / 24px semibold' },
              { cls: 'text-xl font-medium', label: 'xl / 20px medium' },
              { cls: 'text-lg font-medium', label: 'lg / 18px medium' },
              { cls: 'text-base', label: 'base / 16px normal — body minimum' },
              { cls: 'text-sm', label: 'sm / 14px — secondary text' },
              { cls: 'text-xs', label: 'xs / 12px — captions only' },
            ].map(({ cls, label }) => (
              <p key={label} className={`${cls} text-neutral-800`}>
                {label}
              </p>
            ))}
          </div>
        </section>

        {/* ── Buttons ── */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-neutral-800">Buttons</h2>
          <div className="flex gap-3 flex-wrap items-center">
            <Button variant="primary" size="md">
              Primary CTA
            </Button>
            <Button variant="secondary" size="md">
              Secondary
            </Button>
            <Button variant="outline" size="md">
              Outline
            </Button>
            <Button variant="ghost" size="md">
              Ghost
            </Button>
            <Button variant="destructive" size="md">
              Destructive
            </Button>
          </div>
          <div className="flex gap-3 flex-wrap items-center">
            <Button variant="primary" size="sm">
              Small (36px)
            </Button>
            <Button variant="primary" size="md">
              Medium 44px ✓
            </Button>
            <Button variant="primary" size="lg">
              Large 48px ✓
            </Button>
            <Button variant="primary" loading size="md">
              Loading
            </Button>
            <Button variant="primary" disabled size="md">
              Disabled
            </Button>
          </div>
        </section>

        {/* ── Inputs + Field ── */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-neutral-800">Inputs &amp; Field</h2>
          <div className="grid grid-cols-1 gap-4 max-w-sm">
            <Field id="demo-name" label="Full name" hint="As it appears on your passport" required>
              <Input placeholder="e.g. Ramesh Kumar" />
            </Field>
            <Field id="demo-phone" label="Phone" error="Please enter a valid phone number">
              <Input type="tel" placeholder="+91 98765 43210" />
            </Field>
            <div>
              <Label htmlFor="demo-bare">Bare input (44px height)</Label>
              <Input id="demo-bare" className="mt-1.5" placeholder="Stand-alone input" />
            </div>
          </div>
        </section>

        {/* ── Cards ── */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-neutral-800">Cards</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle>Card title</CardTitle>
                <CardDescription>Secondary description text</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-neutral-700">Body content inside the card.</p>
              </CardContent>
              <CardFooter>
                <Button variant="primary" size="sm">
                  Action
                </Button>
              </CardFooter>
            </Card>
            <Card className="border-primary-200">
              <CardHeader>
                <CardTitle className="text-primary-700">Highlighted card</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-neutral-600">
                  Cards use border-radius-lg and shadow-sm.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ── Badges ── */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-neutral-800">Badges (semantic)</h2>
          <div className="flex gap-2 flex-wrap">
            <Badge variant="success">Selected ✓</Badge>
            <Badge variant="warning">Pending</Badge>
            <Badge variant="error">Rejected</Badge>
            <Badge variant="info">Info</Badge>
            <Badge variant="neutral">Neutral</Badge>
            <Badge variant="primary">Primary</Badge>
            <Badge variant="accent">Accent</Badge>
          </div>
        </section>

        {/* ── Loading States ── */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-neutral-800">Loading States</h2>
          <div className="flex gap-6 items-center">
            <div className="flex flex-col items-center gap-2">
              <Spinner size={24} />
              <span className="text-xs text-neutral-500">Spinner (action)</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Spinner size={20} className="text-accent-500" />
              <span className="text-xs text-neutral-500">Accent colour</span>
            </div>
          </div>
          <div className="space-y-2 max-w-xs">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
            <p className="text-xs text-neutral-500">Skeleton (content shape)</p>
          </div>
        </section>

        {/* ── RTL proof ── */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-neutral-800">RTL / Logical Properties</h2>
          <p className="text-sm text-neutral-600">
            Switch locale to <code className="bg-neutral-100 px-1 rounded text-xs">ar</code> via URL
            (e.g. <code className="bg-neutral-100 px-1 rounded text-xs">/ar/kitchen-sink</code>) to
            see dir=rtl, Arabic font, and all primitives mirrored via logical properties
            (ps-/pe-/start-/end-).
          </p>
          <div className="flex items-center gap-3 p-4 bg-neutral-100 rounded-lg">
            <div className="ps-4 pe-2 py-2 bg-primary-100 rounded text-primary-700 text-sm font-medium">
              ps-4 pe-2 (logical)
            </div>
            <Badge variant="info">Flips in RTL ↔</Badge>
            <Button variant="secondary" size="sm">
              Button →
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
