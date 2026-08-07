import { http, HttpResponse } from 'msw';
import type { components } from '@skillindiaconnect/shared-types';
import {
  db,
  buildProfile,
  MOCK_OTP,
  NOT_ON_WHATSAPP_PHONE,
  OTP_RATE_LIMITED_PHONE,
  OTP_SEND_FAILS_PHONE,
  NOT_WHATSAPP_CAPABLE_USER_ID,
  makeAccessToken,
  makeRefreshToken,
  getUserByToken,
  computeCompletion,
  toJobCard,
  toJobDetail,
  computeProfileChecklist,
  toCandidateEmployerView,
  toCandidateBrowseCard,
  evaluateApplyGate,
  computeMatchBreakdown,
  nextApplicationId,
  toApplication,
  toApplicationCard,
  toApplicationDetail,
  toApplicantCard,
  toApplicantSummary,
  computeApplicantCounts,
  EMPLOYER_ALLOWED_TRANSITIONS,
  type MockApplication,
  type MockApplicationTimelineEntry,
  // S5: Billing
  getPlan,
  getSubscriptionStatus,
  getActivePlanMaxJobs,
  nextOrderRef,
  toOrder,
  settleMockOrder,
  ORDER_FLIP_POLL_THRESHOLD,
  MOCK_FAIL_IDEMPOTENCY_PREFIX,
  MOCK_GATEWAY_DOWN_IDEMPOTENCY_PREFIX,
  type MockOrder,
  // S7-0: Resume builder
  buildResumeView,
  RESUME_GENERATION_POLL_THRESHOLD,
  RESUME_FAIL_USER_ID,
  RESUME_SEND_CAP,
  type MockResumeGeneration,
  // S6: Admin console
  roleHasPermission,
  ALL_PERMISSION_KEYS,
  ADMIN_ROLES,
  RESEND_WHATSAPP_CAP,
  LOGS_EXPORT_MAX_ROWS,
  LOGS_EXPORT_MAX_RANGE_DAYS,
  type MockCandidate,
  type MockJob,
} from './data';
import { MOCK_SSR_ORIGIN } from './ssr-origin';

type ErrorSchema = components['schemas']['Error'];
type ApplicationStatusLocal = components['schemas']['ApplicationStatus'];
// S6: Admin console
type PermissionKey = components['schemas']['PermissionKey'];
type AuditLogEntrySchema = components['schemas']['AuditLogEntry'];
type AdminCandidateCardSchema = components['schemas']['AdminCandidateCard'];
type AdminJobRowSchema = components['schemas']['AdminJobRow'];
type AdminJobDetailSchema = components['schemas']['AdminJobDetail'];
type AdminApplicationRowSchema = components['schemas']['AdminApplicationRow'];
type AdminApplicationDetailSchema = components['schemas']['AdminApplicationDetail'];
type NoteEntrySchema = components['schemas']['NoteEntry'];
type MockCandidateShape = MockCandidate;
type MockJobShape = MockJob;

// Browser and jsdom (vitest) both have a `location` global, so a relative
// pattern resolves against the current page origin as usual. Node (SSR via
// instrumentation.ts) has no `location` global — there a relative pattern
// never matches an absolute fetch() URL, so handlers there must be absolute
// against a fixed origin that server-fetch.ts dials. See ssr-origin.ts.
const BASE = typeof location === 'undefined' ? `${MOCK_SSR_ORIGIN}/api/v1` : '/api/v1';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorResponse(
  status: number,
  code: string,
  title: string,
  detail: string,
  meta?: Record<string, unknown>,
) {
  const body: ErrorSchema = {
    type: 'about:blank',
    title,
    status,
    detail,
    code,
    ...(meta ? { meta } : {}),
  };
  return HttpResponse.json(body, { status });
}

function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  return getUserByToken(token);
}

function issueTokens(userId: string) {
  const accessToken = makeAccessToken(userId);
  const refreshToken = makeRefreshToken(userId);
  db.sessions.set(accessToken, { userId, accessToken });
  db.sessions.set(refreshToken, { userId, accessToken: refreshToken });
  return { accessToken, refreshToken };
}

function offsetPaginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    data: items.slice(start, start + pageSize),
    meta: { page, pageSize, total, totalPages },
  };
}

function cursorPaginate<T extends { createdAt: string; id?: string }>(
  items: T[],
  cursor: string | null,
  limit: number,
  options?: {
    /** Defaults to createdAt descending (original behavior). */
    compare?: (a: T, b: T) => number;
    /** Defaults to createdAt. Must be unique per sorted position to dedupe correctly across pages. */
    cursorKey?: (item: T) => string;
  },
): { data: T[]; nextCursor: string | null } {
  const compare =
    options?.compare ??
    ((a: T, b: T) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const cursorKey = options?.cursorKey ?? ((item: T) => item.createdAt);

  const sorted = [...items].sort(compare);
  let startIdx = 0;
  if (cursor) {
    const decoded = atob(cursor);
    const idx = sorted.findIndex((item) => cursorKey(item) === decoded);
    startIdx = idx === -1 ? 0 : idx + 1;
  }
  const page = sorted.slice(startIdx, startIdx + limit);
  const nextCursor =
    startIdx + limit < sorted.length ? btoa(cursorKey(page[page.length - 1]!)) : null;
  return { data: page, nextCursor };
}

// ─── Auth handlers ────────────────────────────────────────────────────────────

const authSignup = http.post(`${BASE}/auth/signup`, async ({ request }) => {
  const body = (await request.json()) as {
    email: string;
    password: string;
    role: 'CANDIDATE' | 'EMPLOYER';
    acceptedTerms: boolean;
  };

  if (!body.email || !body.password || !body.role || !body.acceptedTerms) {
    return errorResponse(
      422,
      'VALIDATION_ERROR',
      'Validation failed',
      'One or more fields are invalid.',
    );
  }

  const existingUser = [...db.users.values()].find((u) => u.email === body.email);
  if (existingUser) {
    return errorResponse(
      409,
      'EMAIL_TAKEN',
      'Email already registered',
      'An account with this email already exists.',
    );
  }

  const id = `mock-user-${Date.now()}`;
  const user = {
    id,
    email: body.email,
    passwordHash: 'hashed',
    role: body.role,
    status: 'ACTIVE' as const,
  };
  db.users.set(id, user);

  if (body.role === 'CANDIDATE') {
    db.candidates.set(id, {
      userId: id,
      profile: buildProfile(id, body.email, {}),
      resumeSettings: {
        language: 'en',
        showPhone: true,
        showReligion: false,
        showFatherName: false,
        showPassportNumber: false,
        template: 'CLASSIC',
      },
      lastRenderedAt: null,
    });
  }

  const { accessToken } = issueTokens(id);

  return HttpResponse.json(
    { data: { user: { id, email: body.email, role: body.role }, accessToken } },
    { status: 201 },
  );
});

const authLogin = http.post(`${BASE}/auth/login`, async ({ request }) => {
  const body = (await request.json()) as { email: string; password: string };

  const user = [...db.users.values()].find((u) => u.email === body.email);
  if (!user) {
    return errorResponse(
      401,
      'INVALID_CREDENTIALS',
      'Invalid credentials',
      'Email or password is incorrect.',
    );
  }
  if (user.status === 'SUSPENDED') {
    return errorResponse(
      403,
      'ACCOUNT_SUSPENDED',
      'Account suspended',
      'Your account has been suspended.',
    );
  }

  const { accessToken } = issueTokens(user.id);

  return HttpResponse.json({
    data: { user: { id: user.id, email: user.email, role: user.role }, accessToken },
  });
});

const authGoogleInit = http.get(`${BASE}/auth/google`, () => {
  return new HttpResponse(null, {
    status: 302,
    headers: { Location: 'https://accounts.google.com/mock-oauth' },
  });
});

const authGoogleCallback = http.get(`${BASE}/auth/google/callback`, () => {
  return new HttpResponse(null, {
    status: 302,
    headers: { Location: '/callback?mock=true' },
  });
});

const authRefresh = http.post(`${BASE}/auth/refresh`, ({ request }) => {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = /sic_refresh=([^;]+)/.exec(cookie);

  // Fallback: when no refresh cookie, accept a valid access token in the
  // Authorization header. AuthProvider fires doRefresh() on every mount (which
  // includes test renders), and that POST carries the current access token.
  // Without this path, doRefresh() returns 401 and calls setAccessToken(null),
  // wiping whatever token loginAs() just set for the test.
  if (!match) {
    const accessToken = (request.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    const session = accessToken ? db.sessions.get(accessToken) : undefined;
    if (!session) {
      return errorResponse(
        401,
        'INVALID_REFRESH',
        'Invalid refresh token',
        'Refresh token is missing or expired.',
      );
    }
    const { accessToken: newToken } = issueTokens(session.userId);
    return HttpResponse.json({ data: { accessToken: newToken } });
  }

  const session = db.sessions.get(match[1]!);
  if (!session) {
    return errorResponse(
      401,
      'INVALID_REFRESH',
      'Invalid refresh token',
      'Refresh token is missing or expired.',
    );
  }

  const { accessToken } = issueTokens(session.userId);
  return HttpResponse.json({ data: { accessToken } });
});

const authLogout = http.post(`${BASE}/auth/logout`, () => {
  return new HttpResponse(null, { status: 204 });
});

const authOtpSend = http.post(`${BASE}/auth/otp/send`, async ({ request }) => {
  const body = (await request.json()) as { phone: string };

  if (body.phone === NOT_ON_WHATSAPP_PHONE) {
    return errorResponse(
      409,
      'PHONE_NOT_ON_WHATSAPP',
      'Phone not on WhatsApp',
      'This number is not reachable via WhatsApp. Please try a different number.',
    );
  }

  // Send-time duplicate guard: a number already verified by another candidate.
  if (body.phone === '+919555555555') {
    return errorResponse(
      409,
      'PHONE_ALREADY_IN_USE',
      'Phone already registered',
      'This number is already registered with another account.',
    );
  }

  // The per-phone budget (5/hour) in OtpService. NOTE the code: the real API
  // emits OTP_RATE_LIMITED here, NOT RATE_LIMIT_EXCEEDED — the mismatch that
  // left the UI's rate-limit branch dead.
  if (body.phone === OTP_RATE_LIMITED_PHONE) {
    return errorResponse(
      429,
      'OTP_RATE_LIMITED',
      'Too Many Requests',
      'Too many verification codes requested. Please wait before trying again.',
    );
  }

  // CR-WA W1.5: the provider is reachable but the send failed. The API answers
  // 503 rather than the `{ sent: true }` it used to lie with.
  if (body.phone === OTP_SEND_FAILS_PHONE) {
    return errorResponse(
      503,
      'OTP_SEND_FAILED',
      'Could not send the code',
      "We couldn't send your code right now. Please try again, or continue with email.",
      { fallbackAvailable: true },
    );
  }

  return HttpResponse.json({ data: { sent: true } });
});

const authOtpVerify = http.post(`${BASE}/auth/otp/verify`, async ({ request }) => {
  const body = (await request.json()) as { phone: string; otp: string };

  if (body.otp !== MOCK_OTP) {
    return errorResponse(
      401,
      'INVALID_OTP',
      'Invalid OTP',
      'OTP is incorrect, expired, or too many attempts.',
    );
  }

  const user = getAuthUser(request);
  if (user) {
    const candidate = db.candidates.get(user.id);
    if (candidate) {
      candidate.profile.phone = body.phone;
      candidate.profile.phoneVerifiedAt = new Date().toISOString();
      candidate.profile.whatsappCapable = true;
      db.verifiedPhones.set(body.phone, user.id);
    }
  }

  return HttpResponse.json({ data: { phoneVerified: true, whatsappCapable: true } });
});

const authLoginPhoneStart = http.post(`${BASE}/auth/login/phone/start`, () => {
  return HttpResponse.json({ data: { message: 'If an account exists, an OTP has been sent.' } });
});

const authLoginPhoneVerify = http.post(`${BASE}/auth/login/phone/verify`, async ({ request }) => {
  const body = (await request.json()) as { phone: string; otp: string };

  if (body.otp !== MOCK_OTP) {
    return errorResponse(
      401,
      'INVALID_OTP',
      'Invalid OTP',
      'OTP is incorrect, expired, or too many attempts.',
    );
  }

  const userId = db.verifiedPhones.get(body.phone);
  if (!userId) {
    return errorResponse(
      401,
      'INVALID_OTP',
      'Invalid OTP',
      'OTP is incorrect, expired, or too many attempts.',
    );
  }

  const user = db.users.get(userId);
  if (!user || user.role !== 'CANDIDATE') {
    return errorResponse(
      401,
      'INVALID_OTP',
      'Invalid OTP',
      'OTP is incorrect, expired, or too many attempts.',
    );
  }

  const { accessToken } = issueTokens(user.id);
  return HttpResponse.json({
    data: { user: { id: user.id, email: user.email, role: user.role }, accessToken },
  });
});

const authForgotPassword = http.post(`${BASE}/auth/forgot-password`, () => {
  return HttpResponse.json({
    data: { message: 'If this email is registered, a reset link has been sent.' },
  });
});

const authResetPassword = http.post(`${BASE}/auth/reset-password`, async ({ request }) => {
  const body = (await request.json()) as { token: string; password: string };

  if (!body.token || body.token === 'invalid-token') {
    return errorResponse(
      400,
      'INVALID_RESET_TOKEN',
      'Invalid reset token',
      'The reset token is invalid or has expired.',
    );
  }

  return HttpResponse.json({ data: { reset: true } });
});

// ─── Candidate profile handlers ───────────────────────────────────────────────

const candidateMe = http.get(`${BASE}/candidates/me`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const candidate = db.candidates.get(user.id);
  if (!candidate)
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

  return HttpResponse.json({ data: candidate.profile });
});

const candidateMePatch = http.patch(`${BASE}/candidates/me`, async ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const candidate = db.candidates.get(user.id);
  if (!candidate)
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

  const body = (await request.json()) as Partial<typeof candidate.profile>;
  Object.assign(candidate.profile, body);

  const { pct } = computeCompletion(candidate.profile);
  candidate.profile.completionPct = pct;

  return HttpResponse.json({ data: candidate.profile });
});

const candidateMeCompletion = http.get(`${BASE}/candidates/me/completion`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const candidate = db.candidates.get(user.id);
  if (!candidate)
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

  const result = computeCompletion(candidate.profile);
  return HttpResponse.json({ data: result });
});

const candidateMeSettingsPatch = http.patch(
  `${BASE}/candidates/me/settings`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const candidate = db.candidates.get(user.id);
    if (!candidate)
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

    const body = (await request.json()) as Record<string, unknown>;
    Object.assign(candidate.profile, body);

    return HttpResponse.json({ data: candidate.profile });
  },
);

const candidateExperiencesPost = http.post(
  `${BASE}/candidates/me/experiences`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const candidate = db.candidates.get(user.id);
    if (!candidate)
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

    const body = (await request.json()) as Omit<components['schemas']['WorkExperience'], 'id'>;
    const exp: components['schemas']['WorkExperience'] = {
      id: `exp-${Date.now()}`,
      ...body,
    };

    candidate.profile.experiences = [...(candidate.profile.experiences ?? []), exp];

    const { pct } = computeCompletion(candidate.profile);
    candidate.profile.completionPct = pct;

    return HttpResponse.json({ data: exp }, { status: 201 });
  },
);

const candidateExperiencePatch = http.patch(
  `${BASE}/candidates/me/experiences/:id`,
  async ({ request, params }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const candidate = db.candidates.get(user.id);
    if (!candidate)
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

    const id = params['id'] as string;
    const idx = (candidate.profile.experiences ?? []).findIndex((e) => e.id === id);
    if (idx === -1) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Experience not found.');

    const body = (await request.json()) as Partial<components['schemas']['WorkExperience']>;
    const updated = { ...candidate.profile.experiences![idx]!, ...body };
    candidate.profile.experiences![idx] = updated;

    return HttpResponse.json({ data: updated });
  },
);

const candidateExperienceDelete = http.delete(
  `${BASE}/candidates/me/experiences/:id`,
  ({ request, params }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const candidate = db.candidates.get(user.id);
    if (!candidate)
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

    const id = params['id'] as string;
    const before = candidate.profile.experiences?.length ?? 0;
    candidate.profile.experiences = (candidate.profile.experiences ?? []).filter(
      (e) => e.id !== id,
    );
    if (candidate.profile.experiences.length === before) {
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Experience not found.');
    }

    return new HttpResponse(null, { status: 204 });
  },
);

const candidateSkillsPost = http.post(`${BASE}/candidates/me/skills`, async ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const candidate = db.candidates.get(user.id);
  if (!candidate)
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

  const body = (await request.json()) as { name: string };
  const skill: components['schemas']['CandidateSkill'] = {
    id: `skill-${Date.now()}`,
    name: body.name,
  };

  candidate.profile.skills = [...(candidate.profile.skills ?? []), skill];

  const { pct } = computeCompletion(candidate.profile);
  candidate.profile.completionPct = pct;

  return HttpResponse.json({ data: skill }, { status: 201 });
});

const candidateSkillDelete = http.delete(
  `${BASE}/candidates/me/skills/:id`,
  ({ request, params }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const candidate = db.candidates.get(user.id);
    if (!candidate)
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

    const id = params['id'] as string;
    const before = candidate.profile.skills?.length ?? 0;
    candidate.profile.skills = (candidate.profile.skills ?? []).filter((s) => s.id !== id);
    if ((candidate.profile.skills?.length ?? 0) === before) {
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Skill not found.');
    }

    return new HttpResponse(null, { status: 204 });
  },
);

const candidateDocumentsPresign = http.post(
  `${BASE}/candidates/me/documents/presign`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const body = (await request.json()) as {
      type: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    };

    const sizeLimits: Record<string, number> = {
      PASSPORT: 10 * 1024 * 1024,
      EXPERIENCE_CERT: 5 * 1024 * 1024,
      EDUCATIONAL_CERT: 5 * 1024 * 1024,
    };

    if (body.sizeBytes > (sizeLimits[body.type] ?? 5 * 1024 * 1024)) {
      return errorResponse(
        422,
        'FILE_TOO_LARGE',
        'File too large',
        `${body.type} documents must be under ${(sizeLimits[body.type] ?? 5 * 1024 * 1024) / 1024 / 1024} MB.`,
      );
    }

    const key = `uploads/${user.id}/${body.type.toLowerCase()}-${Date.now()}/${body.fileName}`;

    return HttpResponse.json({
      data: {
        uploadUrl: `https://mock-r2.example.com/${key}?sig=mock`,
        key,
        expiresInSeconds: 300,
      },
    });
  },
);

const candidateDocumentsConfirm = http.post(
  `${BASE}/candidates/me/documents/confirm`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const candidate = db.candidates.get(user.id);
    if (!candidate)
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

    const body = (await request.json()) as { key: string; expiryDate?: string };

    if (!body.key || body.key === 'invalid-key') {
      return errorResponse(
        422,
        'UPLOAD_NOT_FOUND',
        'Upload not found',
        'The uploaded file was not found in storage. Please try uploading again.',
      );
    }

    const typeGuess = body.key.includes('passport')
      ? 'PASSPORT'
      : body.key.includes('experience')
        ? 'EXPERIENCE_CERT'
        : 'EDUCATIONAL_CERT';

    const doc: components['schemas']['CandidateDocument'] = {
      id: `doc-${Date.now()}`,
      type: typeGuess as components['schemas']['DocumentType'],
      key: body.key,
      status: 'PENDING',
      uploadedAt: new Date().toISOString(),
      ...(body.expiryDate ? { expiryDate: body.expiryDate } : {}),
    };

    candidate.profile.documents = [...(candidate.profile.documents ?? []), doc];

    const { pct } = computeCompletion(candidate.profile);
    candidate.profile.completionPct = pct;

    return HttpResponse.json({ data: doc });
  },
);

const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const candidatePhotoPresign = http.post(
  `${BASE}/candidates/me/photo/presign`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const body = (await request.json()) as {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    };
    if (!PHOTO_MIME_TYPES.includes(body.mimeType)) {
      return errorResponse(422, 'INVALID_FILE_TYPE', 'Invalid file type', 'Use JPG, PNG or WebP.');
    }
    if (body.sizeBytes > PHOTO_MAX_BYTES) {
      return errorResponse(422, 'FILE_TOO_LARGE', 'File too large', 'Photos must be under 5 MB.');
    }

    const key = `candidates/${user.id}/photo/${Date.now()}-${body.fileName}`;
    return HttpResponse.json({
      data: {
        uploadUrl: `https://mock-r2.example.com/${key}?sig=mock`,
        key,
        expiresInSeconds: 300,
      },
    });
  },
);

const candidatePhotoConfirm = http.post(
  `${BASE}/candidates/me/photo/confirm`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const candidate = db.candidates.get(user.id);
    if (!candidate)
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

    const body = (await request.json()) as { key: string };
    if (!body.key || !body.key.startsWith(`candidates/${user.id}/photo/`)) {
      return errorResponse(403, 'KEY_NOT_OWNED', 'Forbidden', 'This upload key is not yours.');
    }

    // A signed url the browser can render (the mock host DNS-fails on load, which
    // is fine — the wiring is what's under test).
    candidate.profile.photoUrl = `https://mock-r2.example.com/${body.key}?sig=mock`;
    const { pct } = computeCompletion(candidate.profile);
    candidate.profile.completionPct = pct;

    return HttpResponse.json({ data: candidate.profile });
  },
);

const candidateCompleteOnboarding = http.post(
  `${BASE}/candidates/me/complete-onboarding`,
  ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const candidate = db.candidates.get(user.id);
    const pct = candidate ? computeCompletion(candidate.profile).pct : 0;

    return HttpResponse.json({ data: { completionPct: pct } });
  },
);

// ─── S2: Candidate stats (dashboard KPIs) ────────────────────────────────────

const candidateMeStats = http.get(`${BASE}/candidates/me/stats`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  // S4: applied / shortlisted are live counts of the candidate's applications.
  const mine = [...db.applications.values()].filter((a) => a.candidateId === user.id);
  const applied = mine.length;
  const shortlisted = mine.filter((a) => a.status === 'SHORTLISTED').length;
  const profileViews = db.profileViews.filter((v) => v.candidateId === user.id).length;

  return HttpResponse.json({
    data: { applied, profileViews, shortlisted },
  });
});

// ─── S2: Candidate notifications ─────────────────────────────────────────────

const candidateMeNotifications = http.get(`${BASE}/candidates/me/notifications`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const url = new URL(request.url);
  const filter = url.searchParams.get('filter');
  const unreadOnly = url.searchParams.get('unread') === 'true';
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '20', 10));

  // Mirror the backend FILTER_BUCKETS (apps/api/.../list-notifications.dto.ts).
  const filterMap: Record<string, string[]> = {
    applications: ['APPLICATION_SELECTED', 'APPLICATION_SHORTLISTED', 'APPLICATION_REJECTED'],
    jobs: ['NEW_JOB_MATCH', 'JOB_CLOSING_SOON', 'CANDIDATE_MATCHES', 'RESUME_SENT', 'RESUME_READY'],
    profile: ['PROFILE_REMINDER', 'PASSPORT_EXPIRY', 'PROFILE_VIEWED'],
    system: [
      'EMPLOYER_APPROVED',
      'EMPLOYER_REJECTED',
      'EMPLOYER_SUSPENDED',
      'SUBSCRIPTION_PURCHASED',
      'SUBSCRIPTION_EXPIRING',
      'SUBSCRIPTION_EXPIRED',
    ],
  };

  let notifs = db.notifications.get(user.id) ?? [];

  if (filter && filterMap[filter]) {
    notifs = notifs.filter((n) => filterMap[filter]!.includes(n.type));
  }
  if (unreadOnly) {
    notifs = notifs.filter((n) => !n.read);
  }

  const { data, nextCursor } = cursorPaginate(notifs, cursor, limit);
  return HttpResponse.json({ data, nextCursor });
});

const candidateMeNotificationsRead = http.post(
  `${BASE}/candidates/me/notifications/read`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const body = (await request.json()) as { ids?: string[]; all?: boolean };
    const notifs = db.notifications.get(user.id) ?? [];
    const now = new Date().toISOString();
    let markedCount = 0;

    if (body.all) {
      notifs.forEach((n) => {
        if (!n.read) {
          n.read = true;
          n.readAt = now;
          markedCount++;
        }
      });
    } else if (body.ids?.length) {
      const idSet = new Set(body.ids);
      notifs.forEach((n) => {
        if (idSet.has(n.id) && !n.read) {
          n.read = true;
          n.readAt = now;
          markedCount++;
        }
      });
    }

    return HttpResponse.json({ data: { markedCount } });
  },
);

// Employer feed — same per-user store, different base path (mirrors the API's
// EmployerNotificationsController).
const employerMeNotifications = http.get(`${BASE}/employers/me/notifications`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get('unread') === 'true';
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '20', 10));

  let notifs = db.notifications.get(user.id) ?? [];
  if (unreadOnly) notifs = notifs.filter((n) => !n.read);

  const { data, nextCursor } = cursorPaginate(notifs, cursor, limit);
  return HttpResponse.json({ data, nextCursor });
});

const employerMeNotificationsRead = http.post(
  `${BASE}/employers/me/notifications/read`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const body = (await request.json()) as { ids?: string[]; all?: boolean };
    const notifs = db.notifications.get(user.id) ?? [];
    const now = new Date().toISOString();
    let markedCount = 0;

    if (body.all) {
      notifs.forEach((n) => {
        if (!n.read) {
          n.read = true;
          n.readAt = now;
          markedCount++;
        }
      });
    } else if (body.ids?.length) {
      const idSet = new Set(body.ids);
      notifs.forEach((n) => {
        if (idSet.has(n.id) && !n.read) {
          n.read = true;
          n.readAt = now;
          markedCount++;
        }
      });
    }

    return HttpResponse.json({ data: { markedCount } });
  },
);

const accountDelete = http.delete(`${BASE}/account`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const mockUser = db.users.get(user.id);
  if (mockUser) mockUser.status = 'PENDING_DELETION';

  const deletionDueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return HttpResponse.json({ data: { deletionDueAt } }, { status: 202 });
});

// ─── Resume handlers ──────────────────────────────────────────────────────────

const resumeGet = http.get(`${BASE}/candidates/me/resume`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const candidate = db.candidates.get(user.id);
  if (!candidate)
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

  // S7-0: `current` folds the optional /current endpoint into this read —
  // the latest generation (any status) or null when never generated.
  const gen = db.resumeGenerations.get(user.id);
  return HttpResponse.json({
    data: {
      settings: candidate.resumeSettings,
      lastRenderedAt: candidate.lastRenderedAt,
      current: gen ? toResumeGeneration(user.id, gen) : null,
    },
  });
});

const resumeSettingsPatch = http.patch(
  `${BASE}/candidates/me/resume/settings`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const candidate = db.candidates.get(user.id);
    if (!candidate)
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

    const body = (await request.json()) as Partial<components['schemas']['ResumeSettings']>;
    // English-only at MVP — the contract's language enum is [en].
    if (body.language !== undefined && body.language !== 'en') {
      return errorResponse(
        400,
        'VALIDATION_ERROR',
        'Bad Request',
        'Only English resumes are available right now.',
      );
    }
    Object.assign(candidate.resumeSettings, body);

    // NOTE: settings apply at GENERATION — an existing generation's snapshot
    // (db.resumeGenerations) is deliberately NOT touched here.
    return HttpResponse.json({ data: candidate.resumeSettings });
  },
);

// S7-0: builds the wire ResumeGeneration from the mock lifecycle record —
// READY carries the signed url + the VIEW rendered from the settings SNAPSHOT
// (settings apply at GENERATION; later PATCHes don't alter this record).
function toResumeGeneration(userId: string, gen: MockResumeGeneration) {
  const candidate = db.candidates.get(userId);
  const base = { generationId: gen.generationId, status: gen.status };
  if (gen.status === 'READY' && candidate) {
    return {
      ...base,
      resumeId: gen.resumeId,
      downloadUrl: `https://mock-r2.example.com/resumes/${userId}/${gen.generationId}.pdf?sig=mock`,
      expiresInSeconds: 300,
      generatedAt: gen.generatedAt,
      view: buildResumeView(candidate, gen.settingsSnapshot),
    };
  }
  if (gen.status === 'FAILED') {
    return { ...base, failureReason: gen.failureReason ?? 'Rendering failed. Try again.' };
  }
  return base;
}

// POST /generate — 202, PENDING. Only ENQUEUES: the flip to READY happens in
// the STATUS handler after RESUME_GENERATION_POLL_THRESHOLD polls, NEVER
// instantly, so the FE must build the polling UX (the payments-timing lesson).
const resumeGenerate = http.post(`${BASE}/candidates/me/resume/generate`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
  const candidate = db.candidates.get(user.id);
  if (!candidate)
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

  const generationId = `gen-${Date.now()}`;
  db.resumeGenerations.set(user.id, {
    generationId,
    status: 'PENDING',
    pollCount: 0,
    // The SNAPSHOT — a settings PATCH after this moment affects the NEXT
    // generation, not this one.
    settingsSnapshot: { ...candidate.resumeSettings },
  });
  return HttpResponse.json({ data: { generationId, status: 'PENDING' } }, { status: 202 });
});

// GET /status — THE POLL TARGET. PENDING for the first
// RESUME_GENERATION_POLL_THRESHOLD polls, then READY (or FAILED for the
// designated failure fixture).
const resumeStatus = http.get(`${BASE}/candidates/me/resume/status`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
  const gen = db.resumeGenerations.get(user.id);
  if (!gen)
    return errorResponse(404, 'RESUME_NOT_FOUND', 'Not Found', 'No resume has been generated yet.');

  if (gen.status === 'PENDING') {
    gen.pollCount += 1;
    if (gen.pollCount >= RESUME_GENERATION_POLL_THRESHOLD) {
      if (user.id === RESUME_FAIL_USER_ID) {
        gen.status = 'FAILED';
        gen.failureReason = 'Rendering failed. Try generating again.';
      } else {
        gen.status = 'READY';
        gen.resumeId = `resume-${user.id}`;
        gen.generatedAt = new Date().toISOString();
        const candidate = db.candidates.get(user.id);
        if (candidate) candidate.lastRenderedAt = gen.generatedAt;
      }
    }
  }
  return HttpResponse.json({ data: toResumeGeneration(user.id, gen) });
});

// GET /download — re-mints the signed url for the latest READY resume (the
// expired-link refresh affordance). 404 RESUME_NOT_FOUND otherwise.
const resumeDownload = http.get(`${BASE}/candidates/me/resume/download`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
  const gen = db.resumeGenerations.get(user.id);
  if (!gen || gen.status !== 'READY')
    return errorResponse(404, 'RESUME_NOT_FOUND', 'Not Found', 'No resume has been generated yet.');

  return HttpResponse.json({
    data: {
      url: `https://mock-r2.example.com/resumes/${user.id}/${gen.generationId}.pdf?sig=mock`,
      expiresInSeconds: 300,
    },
  });
});

// POST /send-whatsapp — READY required (422), 5/day cap (429), and the
// whatsappCapable=false fixture DEGRADES to EMAIL_FALLBACK (202, not an error).
const resumeSendWhatsapp = http.post(
  `${BASE}/candidates/me/resume/send-whatsapp`,
  ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const gen = db.resumeGenerations.get(user.id);
    if (!gen || gen.status !== 'READY') {
      return errorResponse(
        422,
        'RESUME_NOT_READY',
        'Unprocessable Entity',
        'Generate your resume before sending it.',
      );
    }

    const sends = db.resumeSends.get(user.id) ?? [];
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = sends.filter((t) => new Date(t).getTime() > dayAgo);
    if (recent.length >= RESUME_SEND_CAP) {
      return errorResponse(
        429,
        'RESUME_SEND_LIMIT_EXCEEDED',
        'Too Many Requests',
        "You've reached today's resume send limit. Try again tomorrow.",
      );
    }
    recent.push(new Date().toISOString());
    db.resumeSends.set(user.id, recent);

    // The honest degradation: no WhatsApp → the resume still arrives, by email.
    const delivered = user.id === NOT_WHATSAPP_CAPABLE_USER_ID ? 'EMAIL_FALLBACK' : 'WHATSAPP';
    return HttpResponse.json({ data: { delivered } }, { status: 202 });
  },
);

// POST /send-email — own address only; READY required; NO dedicated cap
// (deliberate — only the global authed limit applies on the real API).
const resumeSendEmail = http.post(`${BASE}/candidates/me/resume/send-email`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const gen = db.resumeGenerations.get(user.id);
  if (!gen || gen.status !== 'READY') {
    return errorResponse(
      422,
      'RESUME_NOT_READY',
      'Unprocessable Entity',
      'Generate your resume before sending it.',
    );
  }
  return HttpResponse.json({ data: { delivered: 'EMAIL' } }, { status: 202 });
});

// ─── S2: Employer handlers ────────────────────────────────────────────────────

const employersRegister = http.post(`${BASE}/employers/register`, async ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  if (user.role !== 'EMPLOYER') {
    return errorResponse(
      403,
      'FORBIDDEN',
      'Forbidden',
      'Only EMPLOYER role users may register a company.',
    );
  }

  if (db.employers.has(user.id)) {
    return errorResponse(
      409,
      'COMPANY_ALREADY_EXISTS',
      'Company already registered',
      'This employer account already has a registered company profile.',
    );
  }

  const body = (await request.json()) as {
    name: string;
    type: 'LOCAL' | 'FOREIGN';
    phone: string;
    location: string;
    employeeRange: string;
    registrationNumber?: string;
    industryType?: string;
    website?: string;
    languagePref?: string;
    description?: string;
    registrationCertKey?: string;
  };

  if (!body.name || !body.type || !body.phone || !body.location || !body.employeeRange) {
    return errorResponse(422, 'VALIDATION_ERROR', 'Validation failed', 'Required fields missing.');
  }

  const company = {
    id: `company-${Date.now()}`,
    name: body.name,
    type: body.type,
    status: 'PENDING' as const,
    registrationNumber: body.registrationNumber,
    industryType: body.industryType,
    phone: body.phone,
    location: body.location,
    website: body.website,
    employeeRange: body.employeeRange as components['schemas']['EmployeeRange'],
    languagePref: (body.languagePref ?? 'en') as 'en' | 'hi' | 'ar',
    description: body.description,
    registrationCertKey: body.registrationCertKey ?? null,
    rejectionReason: null,
    createdAt: new Date().toISOString(),
    approvedAt: null,
  };

  db.employers.set(user.id, company);
  return HttpResponse.json({ data: company }, { status: 201 });
});

const employersMeCompany = http.get(`${BASE}/employers/me/company`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const company = db.employers.get(user.id);
  if (!company) {
    return errorResponse(
      404,
      'NOT_FOUND',
      'Not found',
      'No company profile found. Use POST /employers/register first.',
    );
  }

  return HttpResponse.json({ data: company });
});

const employersMeCompanyPatch = http.patch(`${BASE}/employers/me/company`, async ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const company = db.employers.get(user.id);
  if (!company) {
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'Company not found.');
  }

  const body = (await request.json()) as Partial<typeof company>;
  Object.assign(company, body);

  // Resubmit path: auto-transition REJECTED → PENDING so the form
  // can signal "submitted for review" without a manual admin step.
  if (company.status === 'REJECTED') {
    company.status = 'PENDING';
    company.rejectionReason = null;
  }

  return HttpResponse.json({ data: company });
});

const employersMeCompanyDocumentsPresign = http.post(
  `${BASE}/employers/me/company/documents/presign`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const body = (await request.json()) as {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    };

    const maxBytes = 10 * 1024 * 1024;
    if (body.sizeBytes > maxBytes) {
      return errorResponse(
        422,
        'FILE_TOO_LARGE',
        'File too large',
        'Registration certificate must be under 10 MB.',
      );
    }

    const key = `employer-docs/${user.id}/reg-cert-${Date.now()}/${body.fileName}`;
    return HttpResponse.json({
      data: {
        uploadUrl: `https://mock-r2.example.com/${key}?sig=mock`,
        key,
        expiresInSeconds: 300,
      },
    });
  },
);

const employersMeCompanyDocumentsConfirm = http.post(
  `${BASE}/employers/me/company/documents/confirm`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const company = db.employers.get(user.id);
    if (!company) {
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Company not found.');
    }

    const body = (await request.json()) as { key: string };
    if (!body.key || body.key === 'invalid-key') {
      return errorResponse(
        422,
        'UPLOAD_NOT_FOUND',
        'Upload not found',
        'The uploaded file was not found in storage. Please try uploading again.',
      );
    }

    company.registrationCertKey = body.key;
    return HttpResponse.json({ data: company });
  },
);

const employersMeDashboard = http.get(`${BASE}/employers/me/dashboard`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const company = db.employers.get(user.id);
  if (!company) {
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'No company profile found.');
  }
  if (company.status !== 'APPROVED') {
    return errorResponse(
      403,
      'EMPLOYER_NOT_APPROVED',
      'Employer not approved',
      'Your company profile is pending admin approval.',
    );
  }

  const ownJobs = [...db.jobs.values()].filter((j) => j.companyId === company.id);
  const activeJobs = ownJobs.filter((j) => j.status === 'ACTIVE').length;
  const ownJobIds = new Set(ownJobs.map((j) => j.id));

  // S4: live application counts + recent applicants across the employer's jobs.
  const ownApplications = [...db.applications.values()].filter((a) => ownJobIds.has(a.jobId));
  const shortlisted = ownApplications.filter((a) => a.status === 'SHORTLISTED').length;
  const recentApplicants = [...ownApplications]
    .sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
    .slice(0, 5)
    .map((a) => toApplicantSummary(a));

  const dashboard: components['schemas']['EmployerDashboard'] = {
    kpis: {
      activeJobs,
      totalApplications: ownApplications.length,
      shortlisted,
      totalJobViews: 0,
      hiredThisMonth: 0,
    },
    recentJobs: ownJobs
      .filter((j) => j.status === 'ACTIVE')
      .slice(0, 5)
      .map((j) => toJobCard(j, null)),
    recentApplicants,
    profileChecklist: computeProfileChecklist(user.id),
  };

  return HttpResponse.json({ data: dashboard });
});

const employersMeJobs = http.get(`${BASE}/employers/me/jobs`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const company = db.employers.get(user.id);
  if (!company) {
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'No company profile found.');
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const search = url.searchParams.get('search')?.toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(100, parseInt(url.searchParams.get('pageSize') ?? '20', 10));

  let jobs = [...db.jobs.values()].filter((j) => j.companyId === company.id);

  if (statusFilter) {
    jobs = jobs.filter((j) => j.status === statusFilter);
  }
  if (search) {
    jobs = jobs.filter((j) => j.title.toLowerCase().includes(search));
  }

  // S4: attach the live applicant count that fronts the applicants view (Screen 18).
  const withCounts = jobs.map((j) => {
    const counts = computeApplicantCounts(j.id);
    return {
      ...j,
      applicantCount: counts.pending + counts.shortlisted + counts.selected + counts.rejected,
    };
  });

  const result = offsetPaginate(withCounts, page, pageSize);
  return HttpResponse.json(result);
});

// ─── S2: Jobs — public endpoints ──────────────────────────────────────────────

const getJobs = http.get(`${BASE}/jobs`, ({ request }) => {
  const url = new URL(request.url);
  const market = url.searchParams.get('market');
  const category = url.searchParams.get('category');
  const salaryMin = url.searchParams.get('salaryMin');
  const salaryMax = url.searchParams.get('salaryMax');
  const currency = url.searchParams.get('currency');
  const badge = url.searchParams.get('badge');
  const q = url.searchParams.get('q')?.toLowerCase();
  const sort = url.searchParams.get('sort') ?? 'recent';
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '20', 10));

  const authUser = getAuthUser(request);
  const savedJobIds = authUser ? (db.savedJobs.get(authUser.id) ?? new Set<string>()) : null;

  let jobs = [...db.jobs.values()].filter((j) => j.status === 'ACTIVE');

  if (market) jobs = jobs.filter((j) => j.market === market);
  if (category) jobs = jobs.filter((j) => j.categoryId === category);
  if (salaryMin) jobs = jobs.filter((j) => (j.salaryMin ?? 0) >= parseInt(salaryMin, 10));
  if (salaryMax) jobs = jobs.filter((j) => (j.salaryMax ?? Infinity) <= parseInt(salaryMax, 10));
  if (currency) jobs = jobs.filter((j) => j.salaryCurrency === currency);
  if (badge === 'accommodation') jobs = jobs.filter((j) => j.accommodation);
  if (badge === 'healthInsurance') jobs = jobs.filter((j) => j.healthInsurance);
  if (badge === 'transportation') jobs = jobs.filter((j) => j.transportation);
  if (q)
    jobs = jobs.filter(
      (j) => j.title.toLowerCase().includes(q) || (j.description ?? '').toLowerCase().includes(q),
    );

  const cards = jobs.map((j) => toJobCard(j, savedJobIds));

  // "relevance" has no scoring model yet (no search-rank field in the mock
  // fixtures) — falls back to recency, same as the default. "salary" sorts
  // by the top of the posted range, highest first.
  const compare =
    sort === 'salary'
      ? (a: (typeof cards)[number], b: (typeof cards)[number]) =>
          (b.salaryMax ?? b.salaryMin ?? 0) - (a.salaryMax ?? a.salaryMin ?? 0)
      : undefined;
  const cursorKey =
    sort === 'salary'
      ? (item: (typeof cards)[number]) => `${item.salaryMax ?? item.salaryMin ?? 0}|${item.id}`
      : undefined;

  const { data, nextCursor } = cursorPaginate(
    cards as ((typeof cards)[0] & { createdAt: string })[],
    cursor,
    limit,
    { compare, cursorKey },
  );
  return HttpResponse.json({ data, nextCursor });
});

const getJobById = http.get(`${BASE}/jobs/:id`, ({ request, params }) => {
  const id = params['id'] as string;
  const job = db.jobs.get(id);

  if (!job || job.status !== 'ACTIVE') {
    return errorResponse(
      404,
      'NOT_FOUND',
      'Not found',
      'Job not found or is not currently active.',
    );
  }

  const authUser = getAuthUser(request);
  const savedJobIds = authUser ? (db.savedJobs.get(authUser.id) ?? new Set<string>()) : null;

  const detail = toJobDetail(job, savedJobIds, db.jobs);
  return HttpResponse.json({ data: detail });
});

// ─── S2: Job categories — public enumeration ─────────────────────────────────

const MOCK_JOB_CATEGORIES = [
  { id: 'cat-carpenter', slug: 'carpenter', nameEn: 'Carpenter', nameHi: null, nameAr: null },
  { id: 'cat-driver', slug: 'driver', nameEn: 'Driver', nameHi: null, nameAr: null },
  { id: 'cat-electrician', slug: 'electrician', nameEn: 'Electrician', nameHi: null, nameAr: null },
  { id: 'cat-mason', slug: 'mason', nameEn: 'Mason', nameHi: null, nameAr: null },
  { id: 'cat-plumber', slug: 'plumber', nameEn: 'Plumber', nameHi: null, nameAr: null },
  { id: 'cat-welder', slug: 'welder', nameEn: 'Welder', nameHi: null, nameAr: null },
];

const getJobCategories = http.get(`${BASE}/job-categories`, () =>
  HttpResponse.json({ data: MOCK_JOB_CATEGORIES }),
);

// ─── S2: Jobs — employer CRUD + lifecycle ────────────────────────────────────

const postJobs = http.post(`${BASE}/employers/me/jobs`, async ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const company = db.employers.get(user.id);
  if (!company || company.status !== 'APPROVED') {
    return errorResponse(
      403,
      'EMPLOYER_NOT_APPROVED',
      'Employer not approved',
      'Your company must be approved by an admin before posting jobs.',
    );
  }

  const body = (await request.json()) as Partial<components['schemas']['Job']> & {
    title: string;
    market: 'GULF' | 'LOCAL';
    location: string;
    currency?: string;
    salaryCurrency?: string;
    accommodation: boolean;
    healthInsurance: boolean;
    transportation: boolean;
  };

  if (!body.title || !body.market || !body.location) {
    return errorResponse(422, 'VALIDATION_ERROR', 'Validation failed', 'Required fields missing.');
  }

  const currency = body.currency ?? body.salaryCurrency ?? 'AED';
  const job = {
    id: `job-${Date.now()}`,
    humanId: `JB-2026-${db.jobs.size + 1}`,
    title: body.title,
    status: 'DRAFT' as const,
    market: body.market,
    location: body.location,
    description: body.description,
    categoryId: body.categoryId ?? null,
    salaryMin: body.salaryMin ?? null,
    salaryMax: body.salaryMax ?? null,
    // Store both keys so public (salaryCurrency) and employer (currency) reads agree.
    currency,
    salaryCurrency: currency,
    accommodation: body.accommodation ?? true,
    healthInsurance: body.healthInsurance ?? true,
    transportation: body.transportation ?? true,
    requirements: body.requirements ?? [],
    experienceRequiredYears: body.experienceRequiredYears ?? null,
    vacancies: body.vacancies ?? null,
    genderPreference: body.genderPreference ?? ('ANY' as const),
    companyId: company.id,
    companyName: company.name,
    createdAt: new Date().toISOString(),
    publishedAt: null,
    archivedAt: null,
  };

  db.jobs.set(job.id, job);
  return HttpResponse.json({ data: job }, { status: 201 });
});

const patchJobById = http.patch(`${BASE}/employers/me/jobs/:id`, async ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const id = params['id'] as string;
  const job = db.jobs.get(id);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');

  const company = db.employers.get(user.id);
  if (!company || company.id !== job.companyId) {
    return errorResponse(403, 'FORBIDDEN', 'Forbidden', 'You do not own this job.');
  }

  if (job.status === 'ARCHIVED') {
    return errorResponse(
      422,
      'ILLEGAL_TRANSITION',
      'Invalid transition',
      'Archived jobs are read-only and cannot be edited.',
    );
  }

  const body = (await request.json()) as Partial<components['schemas']['Job']>;
  Object.assign(job, body);

  return HttpResponse.json({ data: job });
});

const publishJob = http.post(`${BASE}/employers/me/jobs/:id/publish`, ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const id = params['id'] as string;
  const job = db.jobs.get(id);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');

  const company = db.employers.get(user.id);

  // Rule 1: employer must be approved
  if (!company || company.status !== 'APPROVED') {
    return errorResponse(
      403,
      'EMPLOYER_NOT_APPROVED',
      'Employer not approved',
      'Your company must be approved before publishing jobs.',
    );
  }

  // Rule 2: worker protection
  const violations: string[] = [];
  if (!job.accommodation) violations.push('accommodation');
  if (!job.healthInsurance) violations.push('healthInsurance');
  if (!job.transportation) violations.push('transportation');
  if (violations.length > 0) {
    return errorResponse(
      422,
      'WORKER_PROTECTION_VIOLATION',
      'Worker protection violation',
      'Job cannot be published — required worker benefits are missing.',
      { violations },
    );
  }

  // Rule 3: quota — plan-driven (S5 seam): the limit is the plan's
  // maxActiveJobs (Free = 1; Pro ACTIVE/GRACE = null = unlimited). After the
  // grace window the FREE limit re-applies (Answer 07). A mock purchase that
  // flips to PAID therefore LIFTS this quota through the same seam.
  const planLimit = getActivePlanMaxJobs(user.id);
  if (planLimit !== null) {
    const activeCount = [...db.jobs.values()].filter(
      (j) => j.companyId === company.id && j.status === 'ACTIVE' && j.id !== id,
    ).length;
    if (activeCount >= planLimit) {
      return errorResponse(
        422,
        'JOB_QUOTA_EXCEEDED',
        'Job quota exceeded',
        `Your plan allows ${planLimit} active job${planLimit === 1 ? '' : 's'}. Archive or pause an existing job first, or upgrade to Pro.`,
        { planLimit, activeCount },
      );
    }
  }

  job.status = 'ACTIVE';
  job.publishedAt = new Date().toISOString();
  return HttpResponse.json({ data: job });
});

const pauseJob = http.post(`${BASE}/employers/me/jobs/:id/pause`, ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const id = params['id'] as string;
  const job = db.jobs.get(id);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');

  if (job.status !== 'ACTIVE') {
    return errorResponse(
      422,
      'ILLEGAL_TRANSITION',
      'Invalid transition',
      'Only ACTIVE jobs can be paused.',
    );
  }

  job.status = 'PAUSED';
  return HttpResponse.json({ data: job });
});

const resumeJob = http.post(`${BASE}/employers/me/jobs/:id/resume`, ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const id = params['id'] as string;
  const job = db.jobs.get(id);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');

  if (job.status !== 'PAUSED') {
    return errorResponse(
      422,
      'ILLEGAL_TRANSITION',
      'Invalid transition',
      'Only PAUSED jobs can be resumed.',
    );
  }

  const company = db.employers.get(user.id);
  if (!company || company.status !== 'APPROVED') {
    return errorResponse(
      403,
      'EMPLOYER_NOT_APPROVED',
      'Employer not approved',
      'Your company must be approved to resume jobs.',
    );
  }

  const violations: string[] = [];
  if (!job.accommodation) violations.push('accommodation');
  if (!job.healthInsurance) violations.push('healthInsurance');
  if (!job.transportation) violations.push('transportation');
  if (violations.length > 0) {
    return errorResponse(
      422,
      'WORKER_PROTECTION_VIOLATION',
      'Worker protection violation',
      'Job cannot be resumed — required worker benefits are missing.',
      { violations },
    );
  }

  job.status = 'ACTIVE';
  job.publishedAt = job.publishedAt ?? new Date().toISOString();
  return HttpResponse.json({ data: job });
});

const archiveJob = http.post(`${BASE}/employers/me/jobs/:id/archive`, ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const id = params['id'] as string;
  const job = db.jobs.get(id);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');

  if (job.status === 'ARCHIVED') {
    return errorResponse(
      422,
      'ILLEGAL_TRANSITION',
      'Invalid transition',
      'Job is already archived.',
    );
  }

  job.status = 'ARCHIVED';
  job.archivedAt = new Date().toISOString();
  return HttpResponse.json({ data: job });
});

const duplicateJob = http.post(`${BASE}/employers/me/jobs/:id/duplicate`, ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const id = params['id'] as string;
  const source = db.jobs.get(id);
  if (!source) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Source job not found.');

  const newJob = {
    ...source,
    id: `job-${Date.now()}`,
    status: 'DRAFT' as const,
    publishedAt: null,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    title: `${source.title} (Copy)`,
  };

  db.jobs.set(newJob.id, newJob);
  return HttpResponse.json({ data: newJob }, { status: 201 });
});

// ─── S2: Jobs — candidate save/unsave ────────────────────────────────────────

const saveJob = http.post(`${BASE}/jobs/:id/save`, ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const id = params['id'] as string;
  const job = db.jobs.get(id);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');

  const saved = db.savedJobs.get(user.id) ?? new Set<string>();
  if (saved.has(id)) {
    return errorResponse(
      409,
      'ALREADY_SAVED',
      'Already saved',
      'This job is already in your saved list.',
    );
  }

  saved.add(id);
  db.savedJobs.set(user.id, saved);
  return HttpResponse.json({ data: { saved: true } }, { status: 201 });
});

const unsaveJob = http.delete(`${BASE}/jobs/:id/save`, ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const id = params['id'] as string;
  const saved = db.savedJobs.get(user.id);
  if (!saved?.has(id)) {
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found in your saved list.');
  }

  saved.delete(id);
  return new HttpResponse(null, { status: 204 });
});

// ─── S2: Admin — employer approval ───────────────────────────────────────────

// DRIFT CORRECTED (S6a-F1). This was a ROLE check (`ADMIN || SUPER_ADMIN`) left
// over from S2, but the real controller gates on Permission.EMPLOYERS_VIEW — which
// a MODERATOR HOLDS. The mock was denying what the server allows, so the console
// would have been built believing moderators cannot review employers. Now it runs
// the same permission gate the API does.
const adminGetEmployers = http.get(`${BASE}/admin/employers`, ({ request }) => {
  const gate = requirePermission(request, 'employers.view');
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const typeFilter = url.searchParams.get('type');
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(100, parseInt(url.searchParams.get('pageSize') ?? '20', 10));

  let companies = [...db.employers.values()];
  if (statusFilter) companies = companies.filter((c) => c.status === statusFilter);
  if (typeFilter) companies = companies.filter((c) => c.type === typeFilter);

  const result = offsetPaginate(companies, page, pageSize);
  return HttpResponse.json(result);
});

// ADDED IN S6a-F2 with its contract entry: the review detail fetches ONE company.
const adminGetEmployer = http.get(`${BASE}/admin/employers/:id`, ({ request, params }) => {
  const gate = requirePermission(request, 'employers.view');
  if (gate.error) return gate.error;

  const id = params['id'] as string;
  const company = [...db.employers.values()].find((c) => c.id === id);
  if (!company) return errorResponse(404, 'COMPANY_NOT_FOUND', 'Not found', 'Company not found.');

  return HttpResponse.json({ data: company });
});

const adminApproveEmployer = http.post(
  `${BASE}/admin/employers/:id/approve`,
  ({ request, params }) => {
    // DRIFT CORRECTED (S6a-F2): was a role check; the real controller gates on
    // employers.approve_reject — which a MODERATOR HOLDS. The old mock denied
    // what the server allows, hiding the moderator's actual job from the UI.
    const gate = requirePermission(request, 'employers.approve_reject');
    if (gate.error) return gate.error;

    const id = params['id'] as string;
    const entry = [...db.employers.entries()].find(([, c]) => c.id === id);
    if (!entry) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Employer not found.');

    const company = entry[1];
    company.status = 'APPROVED';
    company.approvedAt = new Date().toISOString();
    company.rejectionReason = null;

    return HttpResponse.json({ data: company });
  },
);

const adminRejectEmployer = http.post(
  `${BASE}/admin/employers/:id/reject`,
  async ({ request, params }) => {
    const gate = requirePermission(request, 'employers.approve_reject');
    if (gate.error) return gate.error;

    const id = params['id'] as string;
    const entry = [...db.employers.entries()].find(([, c]) => c.id === id);
    if (!entry) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Employer not found.');

    const body = (await request.json()) as { reason?: string };
    if (!body.reason) {
      return errorResponse(
        422,
        'VALIDATION_ERROR',
        'Validation failed',
        'A rejection reason is required.',
      );
    }

    const company = entry[1];
    company.status = 'REJECTED';
    company.rejectionReason = body.reason;

    return HttpResponse.json({ data: company });
  },
);

const adminSuspendEmployer = http.post(
  `${BASE}/admin/employers/:id/suspend`,
  ({ request, params }) => {
    // employers.suspend — a SEPARATE, higher grant than approve_reject
    // (MODERATOR holds approve/reject but NOT this; the UI's missing Suspend
    // button for moderators is proven against this exact denial).
    const gate = requirePermission(request, 'employers.suspend');
    if (gate.error) return gate.error;

    const id = params['id'] as string;
    const entry = [...db.employers.entries()].find(([, c]) => c.id === id);
    if (!entry) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Employer not found.');

    const company = entry[1];
    company.status = 'SUSPENDED';

    // Pause all active jobs owned by this company
    db.jobs.forEach((job) => {
      if (job.companyId === company.id && job.status === 'ACTIVE') {
        job.status = 'PAUSED';
      }
    });

    return HttpResponse.json({ data: company });
  },
);

// ADDED IN S6a-F2 alongside its contract entry: the endpoint has existed since
// S2-B4 but was never frozen or mocked. SUSPENDED → APPROVED only; the paused
// jobs are NOT auto-resumed (a suspension is not erased by ending it — the
// employer resumes each job manually).
const adminReactivateEmployer = http.post(
  `${BASE}/admin/employers/:id/reactivate`,
  ({ request, params }) => {
    const gate = requirePermission(request, 'employers.approve_reject');
    if (gate.error) return gate.error;

    const id = params['id'] as string;
    const entry = [...db.employers.entries()].find(([, c]) => c.id === id);
    if (!entry) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Employer not found.');

    const company = entry[1];
    if (company.status !== 'SUSPENDED') {
      return errorResponse(
        409,
        'ILLEGAL_TRANSITION',
        'Conflict',
        'Only a SUSPENDED company can be reactivated.',
      );
    }

    company.status = 'APPROVED';
    company.approvedAt = new Date().toISOString();
    // Deliberately NOT resuming jobs — mirrors EmployerApprovalService.reactivate.

    return HttpResponse.json({ data: company });
  },
);

// ─── S2: Admin — platform settings ───────────────────────────────────────────

// Gated on the S6a-F1 keys (settings.view / settings.manage), matching the real
// controller. These replaced S2-B1's `logs.view` placeholder — which a MODERATOR
// holds, and which therefore let them WRITE platform settings.
const adminGetSettings = http.get(`${BASE}/admin/settings`, ({ request }) => {
  const gate = requirePermission(request, 'settings.view');
  if (gate.error) return gate.error;

  return HttpResponse.json({ data: db.settings });
});

const adminPatchSettings = http.patch(`${BASE}/admin/settings`, async ({ request }) => {
  const gate = requirePermission(request, 'settings.manage');
  if (gate.error) return gate.error;
  // The core-rule gate below is SEPARATE from settings.manage and stays: even an
  // ADMIN who may edit settings must not flip a worker-protection rule. Same rule
  // the real SettingsService.set enforces.
  const user = gate.user;

  const body = (await request.json()) as { updates: { key: string; value: unknown }[] };

  // VALIDATE-ALL-FIRST, exactly like the real SettingsService: every entry is
  // checked (existence + core-rule gate + declared type) before ANY write. A
  // single failure rejects the whole batch with no side effects — a batch that
  // half-applies is worse than one that fails.
  const resolved: Array<{ setting: (typeof db.settings)[number]; value: unknown }> = [];
  for (const update of body.updates) {
    const setting = db.settings.find((s) => s.key === update.key);
    if (!setting) {
      return errorResponse(
        422,
        'VALIDATION_ERROR',
        'Validation failed',
        `Unknown setting key: ${update.key}`,
      );
    }
    if (setting.isCoreRule && user.role !== 'SUPER_ADMIN') {
      return errorResponse(
        403,
        'CORE_RULE_FORBIDDEN',
        'Core rule forbidden',
        'Only SUPER_ADMIN may modify worker-protection core rules.',
      );
    }
    // Type check against the CURRENT value's runtime type (the real API checks
    // the per-key declared type; the current value always carries it).
    const sameType = Array.isArray(setting.value)
      ? Array.isArray(update.value) &&
        (update.value as unknown[]).every((v) => typeof v === 'string')
      : typeof update.value === typeof setting.value;
    if (!sameType) {
      return errorResponse(
        422,
        'VALIDATION_ERROR',
        'Validation failed',
        `Invalid value type for ${update.key}.`,
      );
    }
    resolved.push({ setting, value: update.value });
  }

  for (const { setting, value } of resolved) {
    setting.value = value as (typeof setting)['value'];
    setting.version = (setting.version ?? 1) + 1;
    setting.updatedAt = new Date().toISOString();
    setting.updatedById = user.id;
  }

  return HttpResponse.json({ data: db.settings });
});

// ─── S3: Employer profile handlers ───────────────────────────────────────────

const employersMeProfile = http.get(`${BASE}/employers/me/profile`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const company = db.employers.get(user.id);
  if (!company) return errorResponse(404, 'NOT_FOUND', 'Not found', 'No company profile found.');
  if (company.status !== 'APPROVED') {
    return errorResponse(
      403,
      'EMPLOYER_NOT_APPROVED',
      'Employer not approved',
      'Your company profile is pending admin approval.',
    );
  }

  const logoKey = db.companyLogos.get(user.id);
  const profile: components['schemas']['EmployerProfile'] = {
    company,
    hiringPreferences: db.hiringPreferences.get(user.id) ?? undefined,
    contacts: db.contactPersons.get(user.id) ?? [],
    logoUrl: logoKey ? `https://mock-r2.example.com/${logoKey}?expires=300` : null,
    profileChecklist: computeProfileChecklist(user.id),
  };
  return HttpResponse.json({ data: profile });
});

const employersMeProfileHiringPreferencesPatch = http.patch(
  `${BASE}/employers/me/profile/hiring-preferences`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const company = db.employers.get(user.id);
    if (!company) return errorResponse(404, 'NOT_FOUND', 'Not found', 'No company profile found.');

    const body = (await request.json()) as components['schemas']['HiringPreferences'];
    db.hiringPreferences.set(user.id, {
      preferredCategories: body.preferredCategories ?? [],
      preferredNationalities: body.preferredNationalities ?? [],
      minExperience: body.minExperience ?? 0,
      notes: body.notes ?? '',
    });
    return HttpResponse.json({ data: db.hiringPreferences.get(user.id) });
  },
);

const employersMeProfileContactsPost = http.post(
  `${BASE}/employers/me/profile/contacts`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const company = db.employers.get(user.id);
    if (!company) return errorResponse(404, 'NOT_FOUND', 'Not found', 'No company profile found.');

    const body = (await request.json()) as {
      name: string;
      role: string;
      phone?: string;
      email?: string;
      isPrimary: boolean;
    };
    if (!body.name || !body.role) {
      return errorResponse(
        422,
        'VALIDATION_ERROR',
        'Validation failed',
        'name and role are required.',
      );
    }

    const contacts = db.contactPersons.get(user.id) ?? [];

    // Single-primary demotion
    if (body.isPrimary) {
      contacts.forEach((c) => {
        c.isPrimary = false;
      });
    }

    const newContact = {
      id: `contact-${Date.now()}`,
      name: body.name,
      role: body.role,
      phone: body.phone,
      email: body.email,
      isPrimary: body.isPrimary ?? false,
      createdAt: new Date().toISOString(),
    };
    contacts.push(newContact);
    db.contactPersons.set(user.id, contacts);

    return HttpResponse.json({ data: newContact }, { status: 201 });
  },
);

const employersMeProfileContactPatch = http.patch(
  `${BASE}/employers/me/profile/contacts/:id`,
  async ({ request, params }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const contacts = db.contactPersons.get(user.id) ?? [];
    const contact = contacts.find((c) => c.id === params.id);
    if (!contact) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Contact not found.');

    const body = (await request.json()) as Partial<{
      name: string;
      role: string;
      phone: string;
      email: string;
      isPrimary: boolean;
    }>;

    if (body.isPrimary) {
      contacts.forEach((c) => {
        c.isPrimary = false;
      });
    }

    Object.assign(contact, body);
    return HttpResponse.json({ data: contact });
  },
);

const employersMeProfileContactDelete = http.delete(
  `${BASE}/employers/me/profile/contacts/:id`,
  ({ request, params }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const contacts = db.contactPersons.get(user.id) ?? [];
    const idx = contacts.findIndex((c) => c.id === params.id);
    if (idx === -1) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Contact not found.');

    contacts.splice(idx, 1);
    db.contactPersons.set(user.id, contacts);
    return new HttpResponse(null, { status: 204 });
  },
);

const employersMeProfileLogoPresign = http.post(
  `${BASE}/employers/me/profile/logo/presign`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const body = (await request.json()) as {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    };
    const allowed = ['image/jpeg', 'image/png'];
    if (!allowed.includes(body.mimeType)) {
      return errorResponse(
        422,
        'INVALID_FILE_TYPE',
        'Invalid file type',
        'Only JPEG and PNG logos are accepted.',
      );
    }
    if (body.sizeBytes > 2 * 1024 * 1024) {
      return errorResponse(
        422,
        'FILE_TOO_LARGE',
        'File too large',
        'Logo must be 2 MB or smaller.',
      );
    }

    const key = `employer-logos/${db.employers.get(user.id)?.id ?? user.id}/${Date.now()}-${body.fileName}`;
    return HttpResponse.json({
      data: {
        uploadUrl: `https://mock-r2.example.com/upload/${key}?presigned=true`,
        key,
        expiresInSeconds: 300,
      },
    });
  },
);

const employersMeProfileLogoConfirm = http.post(
  `${BASE}/employers/me/profile/logo/confirm`,
  async ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const company = db.employers.get(user.id);
    if (!company) return errorResponse(404, 'NOT_FOUND', 'Not found', 'No company profile found.');

    const body = (await request.json()) as { key: string };
    if (!body.key || body.key === 'invalid-key') {
      return errorResponse(
        422,
        'UPLOAD_NOT_FOUND',
        'Upload not found',
        'The uploaded file was not found in storage.',
      );
    }

    db.companyLogos.set(user.id, body.key);

    const profile: components['schemas']['EmployerProfile'] = {
      company,
      hiringPreferences: db.hiringPreferences.get(user.id) ?? undefined,
      contacts: db.contactPersons.get(user.id) ?? [],
      logoUrl: `https://mock-r2.example.com/${body.key}?expires=300`,
      profileChecklist: computeProfileChecklist(user.id),
    };
    return HttpResponse.json({ data: profile });
  },
);

// ─── S3: Candidate browse handlers ───────────────────────────────────────────

const employersCandidatesBrowse = http.get(`${BASE}/employers/candidates`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const company = db.employers.get(user.id);
  if (!company) return errorResponse(404, 'NOT_FOUND', 'Not found', 'No company profile found.');
  if (company.status !== 'APPROVED') {
    return errorResponse(
      403,
      'EMPLOYER_NOT_APPROVED',
      'Employer not approved',
      'Your company profile is pending admin approval.',
    );
  }

  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const minExp = url.searchParams.get('minExperienceYears');
  const hasForeign = url.searchParams.get('hasForeignExperience');
  const availability = url.searchParams.get('availability');
  const q = url.searchParams.get('q')?.toLowerCase();
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100);

  let results = [...db.candidates.values()].filter((mc) => mc.profile.profileVisible !== false);

  if (category) results = results.filter((mc) => mc.profile.jobCategoryId === category);
  if (minExp !== null) {
    const min = parseInt(minExp, 10);
    results = results.filter((mc) => {
      const yrs = (mc.profile.experiences ?? []).reduce((s, e) => s + (e.years ?? 0), 0);
      return yrs >= min;
    });
  }
  if (hasForeign !== null) {
    const wantForeign = hasForeign === 'true';
    results = results.filter((mc) => {
      const has = (mc.profile.experiences ?? []).some((e) => e.type === 'FOREIGN');
      return has === wantForeign;
    });
  }
  if (availability !== null) {
    const wantAvail = availability === 'true';
    results = results.filter((mc) => (mc.profile.isAvailable ?? true) === wantAvail);
  }
  if (q) {
    results = results.filter((mc) => {
      const name = (mc.profile.fullName ?? '').toLowerCase();
      const loc = (mc.profile.currentLocation ?? '').toLowerCase();
      const skills = (mc.profile.skills ?? []).map((s) => s.name.toLowerCase()).join(' ');
      return name.includes(q) || loc.includes(q) || skills.includes(q);
    });
  }

  const cards = results.map((mc) => toCandidateBrowseCard(mc));
  return HttpResponse.json(cursorPaginate(cards, cursor, limit));
});

const employersCandidateView = http.get(
  `${BASE}/employers/candidates/:id`,
  ({ request, params }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const company = db.employers.get(user.id);
    if (!company) return errorResponse(404, 'NOT_FOUND', 'Not found', 'No company profile found.');
    if (company.status !== 'APPROVED') {
      return errorResponse(
        403,
        'EMPLOYER_NOT_APPROVED',
        'Employer not approved',
        'Your company profile is pending admin approval.',
      );
    }

    const candidateId = params.id as string;
    const mc = db.candidates.get(candidateId);

    // profileVisible=false and nonexistent both return identical 404
    if (!mc || mc.profile.profileVisible === false) {
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate not found.');
    }

    // Record profile view with 24h dedup per (company, candidate)
    const dedupKey = `${company.id}:${candidateId}`;
    const lastViewed = db.profileViewDedup.get(dedupKey);
    const now = new Date();
    const isNewView =
      !lastViewed || now.getTime() - new Date(lastViewed).getTime() > 24 * 60 * 60 * 1000;

    if (isNewView) {
      db.profileViewDedup.set(dedupKey, now.toISOString());
      const viewRecord = {
        companyId: company.id,
        companyName: company.name,
        candidateId,
        viewedAt: now.toISOString(),
      };
      db.profileViews.unshift(viewRecord);

      // Fire-and-forget PROFILE_VIEWED notification to candidate
      const notifications = db.notifications.get(candidateId) ?? [];
      notifications.unshift({
        id: `notif-pv-${Date.now()}`,
        type: 'PROFILE_VIEWED',
        title: 'Your profile was viewed',
        body: `${company.name} viewed your profile.`,
        read: false,
        readAt: null,
        createdAt: now.toISOString(),
      } as import('./data').MockNotification);
      db.notifications.set(candidateId, notifications);
    }

    return HttpResponse.json({ data: toCandidateEmployerView(mc) });
  },
);

// ─── S3: Candidate profile-views handler ─────────────────────────────────────

const candidateMeProfileViews = http.get(`${BASE}/candidates/me/profile-views`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const candidateViews = db.profileViews.filter((v) => v.candidateId === user.id);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const last30Days = candidateViews.filter((v) => new Date(v.viewedAt) >= thirtyDaysAgo).length;
  const recentViews = candidateViews
    .slice(0, 20)
    .map((v) => ({ companyName: v.companyName, viewedAt: v.viewedAt }));

  const summary: components['schemas']['ProfileViewsSummary'] = {
    total: candidateViews.length,
    last30Days,
    recentViews,
  };
  return HttpResponse.json({ data: summary });
});

// ─── S4: Applications ─────────────────────────────────────────────────────────

let notifSeq = 1000;
function pushNotification(
  userId: string,
  n: Omit<import('./data').MockNotification, 'id' | 'read' | 'readAt' | 'createdAt'>,
) {
  const list = db.notifications.get(userId) ?? [];
  list.unshift({
    id: `notif-s4-${notifSeq++}`,
    read: false,
    readAt: null,
    createdAt: new Date().toISOString(),
    ...n,
  } as import('./data').MockNotification);
  db.notifications.set(userId, list);
}

// Local cursor slice for lists whose items lack a `createdAt` key (applications
// key on `appliedAt`/`id`). Mirrors cursorPaginate's opaque-base64 contract.
function cursorSlice<T>(
  sorted: T[],
  cursor: string | null,
  limit: number,
  keyOf: (t: T) => string,
): { data: T[]; nextCursor: string | null } {
  let start = 0;
  if (cursor) {
    const decoded = atob(cursor);
    const idx = sorted.findIndex((x) => keyOf(x) === decoded);
    start = idx === -1 ? 0 : idx + 1;
  }
  const data = sorted.slice(start, start + limit);
  const nextCursor =
    start + limit < sorted.length && data.length > 0 ? btoa(keyOf(data[data.length - 1]!)) : null;
  return { data, nextCursor };
}

// POST /jobs/:id/apply — the apply-gate ladder + match snapshot.
const applyToJob = http.post(`${BASE}/jobs/:id/apply`, async ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
  if (user.role !== 'CANDIDATE')
    return errorResponse(403, 'FORBIDDEN', 'Forbidden', 'Only candidates can apply to jobs.');

  const job = db.jobs.get(params.id as string);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');

  const mc = db.candidates.get(user.id);
  if (!mc) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate profile not found.');

  const body = (await request.json().catch(() => ({}))) as { coverLetter?: string };

  const gate = evaluateApplyGate(mc, job);
  if (!gate.ok) {
    switch (gate.code) {
      case 'JOB_NOT_ACTIVE':
        return errorResponse(
          422,
          'JOB_NOT_ACTIVE',
          'Job not active',
          'This job is not accepting applications.',
        );
      case 'ALREADY_APPLIED':
        return errorResponse(
          409,
          'ALREADY_APPLIED',
          'Already applied',
          'You have already applied to this job.',
        );
      case 'PROFILE_INCOMPLETE':
        return errorResponse(
          422,
          'PROFILE_INCOMPLETE',
          'Profile incomplete',
          'Complete your profile before applying.',
          { completionPct: gate.completionPct, threshold: gate.threshold },
        );
      case 'MANDATORY_DOCS_MISSING':
        return errorResponse(
          422,
          'MANDATORY_DOCS_MISSING',
          'Mandatory documents missing',
          'Upload all required documents before applying.',
          { missing: gate.missing },
        );
      case 'PASSPORT_INVALID':
        return errorResponse(
          422,
          'PASSPORT_INVALID',
          'Passport invalid',
          gate.reason === 'expired' ? 'Your passport is expired.' : 'A valid passport is required.',
          { reason: gate.reason },
        );
    }
  }

  // Passed the gate — compute the match snapshot ONCE and persist.
  const { matchScore, matchBreakdown } = computeMatchBreakdown(
    mc,
    job,
    gate.docsCompleteCount,
    gate.docsRequiredCount,
  );
  const { id, humanId } = nextApplicationId();
  const now = new Date().toISOString();
  const app: MockApplication = {
    id,
    humanId,
    jobId: job.id,
    candidateId: user.id,
    status: 'PENDING',
    matchScore,
    matchBreakdown,
    coverLetter: body.coverLetter?.slice(0, 500) ?? null,
    docsCompleteCount: gate.docsCompleteCount,
    docsRequiredCount: gate.docsRequiredCount,
    passportValidAtApply: gate.passportValidAtApply,
    selectedNotifiedAt: null,
    rejectionFeedback: null,
    overrideReason: null,
    appliedAt: now,
    updatedAt: now,
  };
  db.applications.set(id, app);
  db.applicationTimeline.set(id, []);

  // Side effect: notify the owning employer of a new applicant (in-app).
  const employerUserId = [...db.employers.entries()].find(([, c]) => c.id === job.companyId)?.[0];
  if (employerUserId) {
    pushNotification(employerUserId, {
      type: 'CANDIDATE_MATCHES',
      title: 'New applicant',
      body: `${mc.profile.fullName || 'A candidate'} applied to ${job.title}.`,
      relatedEntityId: id,
      relatedEntityType: 'application',
    });
  }

  return HttpResponse.json({ data: toApplication(app, 'candidate') }, { status: 201 });
});

// GET /jobs/:id/applicants — employer applicant list + counts.
const getJobApplicants = http.get(`${BASE}/jobs/:id/applicants`, ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const job = db.jobs.get(params.id as string);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');

  const company = db.employers.get(user.id);
  if (!company || company.id !== job.companyId)
    return errorResponse(403, 'FORBIDDEN', 'Forbidden', 'You do not own this job.');

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '20', 10));
  const statusFilter = url.searchParams.get('status');
  const sort = url.searchParams.get('sort') ?? 'match';

  let apps = [...db.applications.values()].filter((a) => a.jobId === job.id);
  if (statusFilter) apps = apps.filter((a) => a.status === statusFilter);
  apps.sort((a, b) =>
    sort === 'recent'
      ? new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime()
      : b.matchScore - a.matchScore || a.id.localeCompare(b.id),
  );

  const { data, nextCursor } = cursorSlice(apps, cursor, limit, (a) => a.id);
  return HttpResponse.json({
    data: data.map((a) => toApplicantCard(a)),
    nextCursor,
    counts: computeApplicantCounts(job.id),
  });
});

// Shared status-transition side effects (employer + admin paths).
function applyStatusTransition(
  app: MockApplication,
  to: ApplicationStatusLocal,
  actorRole: import('./data').MockApplicationTimelineEntry['actorRole'],
  opts: {
    isAdminOverride: boolean;
    overrideReason: string | null;
    rejectionFeedback?: string | null;
  },
) {
  const from = app.status;
  const now = new Date().toISOString();

  app.status = to;
  app.updatedAt = now;
  if (opts.isAdminOverride) app.overrideReason = opts.overrideReason;
  if (to === 'REJECTED' && opts.rejectionFeedback !== undefined) {
    app.rejectionFeedback = opts.rejectionFeedback;
  }

  const entry: MockApplicationTimelineEntry = {
    fromStatus: from,
    toStatus: to,
    actorRole,
    isAdminOverride: opts.isAdminOverride,
    overrideReason: opts.overrideReason,
    createdAt: now,
  };
  const timeline = db.applicationTimeline.get(app.id) ?? [];
  timeline.push(entry);
  db.applicationTimeline.set(app.id, timeline);

  // SELECTED side effect: WhatsApp fires ONCE (guarded by selectedNotifiedAt).
  if (to === 'SELECTED' && app.selectedNotifiedAt === null) {
    app.selectedNotifiedAt = now; // first entry → the once-per-application receipt
  }
  // Notification on every status change into a terminal/interesting state.
  const notifByStatus: Partial<
    Record<ApplicationStatusLocal, import('./data').MockNotification['type']>
  > = {
    SHORTLISTED: 'APPLICATION_SHORTLISTED',
    SELECTED: 'APPLICATION_SELECTED',
    REJECTED: 'APPLICATION_REJECTED',
  };
  const notifType = notifByStatus[to];
  if (notifType) {
    const job = db.jobs.get(app.jobId);
    pushNotification(app.candidateId, {
      type: notifType,
      title:
        to === 'SELECTED'
          ? 'You have been selected'
          : to === 'SHORTLISTED'
            ? 'Application shortlisted'
            : 'Application update',
      body: `Your application for ${job?.title ?? 'a job'} is now ${to.toLowerCase()}.`,
      relatedEntityId: app.id,
      relatedEntityType: 'application',
    });
  }
}

// PATCH /applications/:id/status — employer forward-only move.
const patchApplicationStatus = http.patch(
  `${BASE}/applications/:id/status`,
  async ({ request, params }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const app = db.applications.get(params.id as string);
    if (!app) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Application not found.');

    const job = db.jobs.get(app.jobId);
    const company = db.employers.get(user.id);
    if (!company || !job || company.id !== job.companyId)
      return errorResponse(403, 'FORBIDDEN', 'Forbidden', 'You do not own this application.');

    const body = (await request.json()) as {
      status: ApplicationStatusLocal;
      rejectionFeedback?: string;
    };

    const allowed = EMPLOYER_ALLOWED_TRANSITIONS[app.status] ?? [];
    if (!allowed.includes(body.status)) {
      return errorResponse(
        422,
        'ILLEGAL_TRANSITION',
        'Illegal transition',
        'Employers can only move an application forward.',
        { from: app.status, to: body.status, allowed },
      );
    }

    applyStatusTransition(app, body.status, 'EMPLOYER', {
      isAdminOverride: false,
      overrideReason: null,
      rejectionFeedback: body.rejectionFeedback ?? null,
    });

    return HttpResponse.json({ data: toApplication(app, 'employer') });
  },
);

// GET /candidates/me/applications — candidate list.
const candidateMeApplications = http.get(`${BASE}/candidates/me/applications`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '20', 10));
  const statusFilter = url.searchParams.get('status');

  let mine = [...db.applications.values()].filter((a) => a.candidateId === user.id);
  if (statusFilter) mine = mine.filter((a) => a.status === statusFilter);
  mine.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());

  const { data, nextCursor } = cursorSlice(mine, cursor, limit, (a) => a.id);
  return HttpResponse.json({ data: data.map((a) => toApplicationCard(a)), nextCursor });
});

// GET /candidates/me/applications/:id — candidate detail (timeline, no overrideReason).
const candidateMeApplicationById = http.get(
  `${BASE}/candidates/me/applications/:id`,
  ({ request, params }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const app = db.applications.get(params.id as string);
    if (!app || app.candidateId !== user.id)
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Application not found.');

    return HttpResponse.json({ data: toApplicationDetail(app) });
  },
);

// The admin row (contract AdminApplicationRow, 0.8.1): the admin-context
// application + the display denormalizations. `overrideReason` is DERIVED from
// the timeline — the record of record — exactly like the real read service.
function toAdminApplicationRow(app: MockApplication): AdminApplicationRowSchema {
  const candidate = db.candidates.get(app.candidateId);
  const job = db.jobs.get(app.jobId);
  const lastOverride = [...(db.applicationTimeline.get(app.id) ?? [])]
    .reverse()
    .find((e) => e.isAdminOverride);
  return {
    ...toApplication(app, 'admin'),
    overrideReason: lastOverride?.overrideReason ?? null,
    candidateName: candidate?.profile.fullName ?? null,
    jobTitle: job?.title ?? null,
  };
}

// GET /admin/applications — admin table (offset, admin context keeps overrideReason).
// Gated on applications.manage, matching AdminApplicationsController. (A
// MODERATOR holds applications.notes but NOT manage — so they cannot reach the
// list at all. That is a dead grant in the seed and a real question for the
// backend, but the mock's job is to tell the truth about it, not paper over it.)
const adminGetApplications = http.get(`${BASE}/admin/applications`, ({ request }) => {
  const gate = requirePermission(request, 'applications.manage');
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(100, parseInt(url.searchParams.get('pageSize') ?? '20', 10));
  const statusFilter = url.searchParams.get('status');
  const jobId = url.searchParams.get('jobId');
  const search = url.searchParams.get('search')?.toLowerCase();

  let rows = [...db.applications.values()].map(toAdminApplicationRow);
  if (statusFilter) rows = rows.filter((a) => a.status === statusFilter);
  if (jobId) rows = rows.filter((a) => a.jobId === jobId);
  if (search) {
    // The 0.8.1-documented behavior: humanId or candidate name.
    rows = rows.filter(
      (a) =>
        a.humanId.toLowerCase().includes(search) ||
        (a.candidateName ?? '').toLowerCase().includes(search),
    );
  }
  rows.sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime());

  return HttpResponse.json(offsetPaginate(rows, page, pageSize));
});

// GET /admin/applications/:id — the Screen 26 detail (0.8.1): the admin row +
// the FULL timeline with per-entry overrideReason. This is the ONLY
// serialization of the reason; the candidate's shaped timeline drops it.
const adminGetApplication = http.get(`${BASE}/admin/applications/:id`, ({ request, params }) => {
  const gate = requirePermission(request, 'applications.manage');
  if (gate.error) return gate.error;

  const app = db.applications.get(params['id'] as string);
  if (!app) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Application not found.');

  const detail: AdminApplicationDetailSchema = {
    ...toAdminApplicationRow(app),
    timeline: (db.applicationTimeline.get(app.id) ?? []).map((e) => ({
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorRole: e.actorRole,
      isAdminOverride: e.isAdminOverride,
      overrideReason: e.overrideReason,
      createdAt: e.createdAt,
    })),
  };
  return HttpResponse.json({ data: detail });
});

// PATCH /admin/applications/:id/status — corrective override (reason required).
const adminPatchApplicationStatus = http.patch(
  `${BASE}/admin/applications/:id/status`,
  async ({ request, params }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')
      return errorResponse(403, 'FORBIDDEN', 'Forbidden', 'Admin access required.');

    const app = db.applications.get(params.id as string);
    if (!app) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Application not found.');

    const body = (await request.json()) as {
      status: ApplicationStatusLocal;
      overrideReason?: string;
    };
    if (!body.overrideReason || body.overrideReason.trim().length === 0) {
      return errorResponse(
        422,
        'OVERRIDE_REASON_REQUIRED',
        'Override reason required',
        'A corrective status change requires a reason.',
      );
    }

    applyStatusTransition(app, body.status, 'ADMIN', {
      isAdminOverride: true,
      overrideReason: body.overrideReason,
    });

    return HttpResponse.json({ data: toApplication(app, 'admin') });
  },
);

// ─── Health ───────────────────────────────────────────────────────────────────

// ─── S5: Billing handlers ─────────────────────────────────────────────────────
// NO webhook handlers here — /webhooks/razorpay and /webhooks/stripe are
// server-to-server (signature-authed) and never called by the web app. The
// mocks simulate the webhook's EFFECT instead: an order flips CREATED→PAID
// only after ORDER_FLIP_POLL_THRESHOLD polls of GET /billing/orders/{id}
// (settleMockOrder), so instant activation is IMPOSSIBLE on mocks and the FE
// must build the "confirming your payment…" polling state.

const billingPlans = http.get(`${BASE}/billing/plans`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
  return HttpResponse.json({ data: db.plans });
});

const billingSubscription = http.get(`${BASE}/billing/subscription`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
  // Never a 404 — no record = the well-formed FREE state.
  return HttpResponse.json({ data: getSubscriptionStatus(user.id) });
});

const billingInvoices = http.get(`${BASE}/billing/invoices`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '20');

  const mine = db.invoices
    .filter((inv) => inv.userId === user.id)
    .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())
    // Strip the mock-internal userId down to the contract Invoice shape.
    .map(({ userId: _internal, ...invoice }) => invoice);

  return HttpResponse.json(offsetPaginate(mine, page, pageSize));
});

const billingCheckout = http.post(`${BASE}/billing/checkout`, async ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const company = db.employers.get(user.id);
  if (!company || company.status !== 'APPROVED') {
    return errorResponse(
      403,
      'EMPLOYER_NOT_APPROVED',
      'Employer not approved',
      'Your company must be approved before purchasing a plan.',
    );
  }

  // Idempotency: a seen key replays the ORIGINAL session verbatim — a retry
  // never creates a second order.
  const idemKey = request.headers.get('Idempotency-Key');
  if (idemKey && db.checkoutIdempotency.has(idemKey)) {
    const existing = db.orders.get(db.checkoutIdempotency.get(idemKey)!);
    if (existing) return HttpResponse.json({ data: existing.session }, { status: 201 });
  }

  const body = (await request.json()) as { planCode?: string };
  const plan = body.planCode ? getPlan(body.planCode as never) : undefined;
  // FREE (or an unknown/inactive plan) is not purchasable.
  if (!plan || plan.code === 'FREE' || plan.priceSubunits === 0) {
    return errorResponse(
      422,
      'PLAN_NOT_PURCHASABLE',
      'Plan not purchasable',
      'The FREE plan cannot be purchased.',
    );
  }

  // Same plan already active and not yet inside the renewal window → 409.
  // (Same-plan renewal EXTENDS the term; it opens 7 days before expiry.)
  const sub = getSubscriptionStatus(user.id);
  if (sub.plan.code === plan.code && sub.status === 'ACTIVE' && !sub.renewable) {
    return errorResponse(
      409,
      'SUBSCRIPTION_ALREADY_ACTIVE',
      'Subscription already active',
      `Your ${plan.name} plan is already active. Renewal opens 7 days before expiry.`,
    );
  }

  // The honest no-usable-gateway failure (reachable via the gwdown- key prefix).
  if (idemKey?.startsWith(MOCK_GATEWAY_DOWN_IDEMPOTENCY_PREFIX)) {
    return errorResponse(
      503,
      'GATEWAY_UNAVAILABLE',
      'Service Unavailable',
      'International payments are temporarily unavailable. Please try again later.',
    );
  }

  // SERVER-SIDE routing — the request carries { planCode } ONLY, and the
  // client can never force a gateway:
  //   LOCAL   → Razorpay domestic, GST added (the authoritative split)
  //   FOREIGN → Razorpay International; Stripe only when STRIPE_ENABLED is on
  const stripeEnabled =
    db.settings.find((s) => s.key === 'payments.stripe_enabled')?.value === true;
  const isLocal = company.type === 'LOCAL';
  const gateway: components['schemas']['PaymentGateway'] =
    !isLocal && stripeEnabled ? 'STRIPE' : 'RAZORPAY';

  const amountSubunits = plan.priceSubunits;
  const gstSubunits = isLocal ? Math.round((amountSubunits * (plan.gstRatePct ?? 18)) / 100) : 0;
  const totalSubunits = amountSubunits + gstSubunits;

  const orderId = `mock-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session: components['schemas']['CheckoutSession'] = {
    orderId,
    humanOrderRef: nextOrderRef(),
    gateway,
    amountSubunits,
    gstSubunits,
    totalSubunits,
    currency: plan.currency,
    // EXACTLY ONE gateway block, always matching `gateway`.
    ...(gateway === 'RAZORPAY'
      ? { razorpay: { keyId: 'rzp_test_mock', gatewayOrderId: `order_Mock${orderId.slice(-6)}` } }
      : { stripe: { redirectUrl: `https://checkout.stripe.com/c/pay/mock-${orderId}` } }),
  };

  const order: MockOrder = {
    id: orderId,
    humanOrderRef: session.humanOrderRef!,
    userId: user.id,
    planCode: plan.code,
    status: 'CREATED', // webhook-only activation: NEVER PAID at creation
    gateway,
    amountSubunits,
    gstSubunits,
    totalSubunits,
    currency: plan.currency,
    createdAt: new Date().toISOString(),
    subscriptionActivatedAt: null,
    invoiceId: null,
    pollCount: 0,
    failOnFlip: idemKey?.startsWith(MOCK_FAIL_IDEMPOTENCY_PREFIX) ?? false,
    session,
  };
  db.orders.set(orderId, order);
  if (idemKey) db.checkoutIdempotency.set(idemKey, orderId);

  return HttpResponse.json({ data: session }, { status: 201 });
});

const billingOrderById = http.get(`${BASE}/billing/orders/:id`, ({ request, params }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const order = db.orders.get(params['id'] as string);
  // Nonexistent and another company's order are indistinguishable (404).
  if (!order || order.userId !== user.id) {
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'Order not found.');
  }

  // THE simulated webhook effect: the flip happens only after enough polls —
  // never at checkout, never on a client callback. On PAID, settleMockOrder
  // activates the subscription, mints the next sequential invoice, and the
  // publish quota lifts via the plan seam.
  order.pollCount += 1;
  if (order.status === 'CREATED' && order.pollCount >= ORDER_FLIP_POLL_THRESHOLD) {
    settleMockOrder(order);
  }

  return HttpResponse.json({ data: toOrder(order) });
});

// S5: the Pro document gate — the S3 decision-2 landing.
const employersCandidateDocumentUrl = http.get(
  `${BASE}/employers/candidates/:id/documents/:type/url`,
  ({ request, params }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    const company = db.employers.get(user.id);
    if (!company) return errorResponse(404, 'NOT_FOUND', 'Not found', 'No company profile found.');
    if (company.status !== 'APPROVED') {
      return errorResponse(
        403,
        'EMPLOYER_NOT_APPROVED',
        'Employer not approved',
        'Your company profile is pending admin approval.',
      );
    }

    // Plan gate: document access is Pro-only (ACTIVE or GRACE). Free → the
    // upsell driver.
    const sub = getSubscriptionStatus(user.id);
    const isPro = sub.plan.code !== 'FREE' && (sub.status === 'ACTIVE' || sub.status === 'GRACE');
    if (!isPro) {
      return errorResponse(
        403,
        'PLAN_UPGRADE_REQUIRED',
        'Forbidden',
        'Document access is a Pro feature. Upgrade to view candidate documents.',
      );
    }

    // S3 privacy inheritance — 404 indistinguishability: nonexistent, hidden
    // (profileVisible=false), and absent-document all return the SAME 404. The
    // plan gate above never bypasses these checks for visible data.
    const candidateId = params['id'] as string;
    const mc = db.candidates.get(candidateId);
    if (!mc || mc.profile.profileVisible === false) {
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Not found.');
    }
    const docType = params['type'] as string;
    const doc = (mc.profile.documents ?? []).find((d) => d.type === docType);
    if (!doc) {
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Not found.');
    }

    // Real system: short-expiry signed R2 GET, every issuance audited.
    return HttpResponse.json({
      data: {
        url: `https://r2.mock.skillindiaconnect.example/candidate-docs/${candidateId}/${docType}?sig=mock&exp=300`,
        expiresInSeconds: 300,
      },
    });
  },
);

const health = http.get('/health', () => {
  return HttpResponse.json({ status: 'ok (mock)' });
});

// ─── S6: Admin console handlers ───────────────────────────────────────────────
//
// RBAC-ACCURATE BY DESIGN. Every handler below runs `requirePermission()` against
// the SAME seeded matrix the API uses (data.ts SEED_MATRIX ← prisma/seed.ts), so
// the console is built against REAL denials:
//   - MODERATOR → GET  /admin/logs/export            → 403 (logs.export off)
//   - MODERATOR → PATCH /admin/roles/matrix          → 403 (roles.manage locked off)
//   - ADMIN     → POST /admin/candidates/{id}/purge  → 403 (candidates.delete off)
//   - SUPER_ADMIN → everything                       → allowed
// A permissive mock would ship an admin UI full of buttons a MODERATOR can't use.
//
// EN-only: no HI/AR fixtures, no RTL obligations on admin screens.

/** 403 with the permission the caller lacked — the contract's AdminForbidden. */
function forbidden(requiredPermission: PermissionKey) {
  return HttpResponse.json(
    {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: 'You do not have permission to perform this action.',
      code: 'FORBIDDEN',
      meta: { requiredPermission },
    } satisfies ErrorSchema,
    { status: 403 },
  );
}

/**
 * The single RBAC gate. Returns the acting user, or an error Response to return
 * verbatim. Mirrors the API's guard: 401 without a token, 403 without the grant.
 */
function requirePermission(request: Request, permission: PermissionKey) {
  const user = getAuthUser(request);
  if (!user) {
    return {
      error: errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.'),
    };
  }
  if (!roleHasPermission(user.role, permission)) {
    return { error: forbidden(permission) };
  }
  return { user };
}

/** Append an audit row — the admin console's own actions are audited too. */
function writeAudit(entry: Omit<AuditLogEntrySchema, 'id' | 'createdAt'>) {
  db.auditLogs.unshift({
    ...entry,
    id: String(++db.nextAuditLogId),
    createdAt: new Date().toISOString(),
  } as AuditLogEntrySchema);
}

// ── Screen 29: audit log ─────────────────────────────────────────────────────

/** Shared filter for the log query + the CSV export. */
function filterAuditLogs(url: URL): AuditLogEntrySchema[] {
  // NOT `module` — Next.js forbids assigning that identifier (no-assign-module-variable).
  const moduleFilter = url.searchParams.get('module');
  const action = url.searchParams.get('action');
  const actorId = url.searchParams.get('actorId');
  const status = url.searchParams.get('status');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const q = url.searchParams.get('q');

  return db.auditLogs.filter((row) => {
    if (moduleFilter && row.module !== moduleFilter) return false;
    if (action && row.action !== action) return false;
    if (actorId && row.actorUserId !== actorId) return false;
    if (status && row.status !== status) return false;
    if (from && row.createdAt < from) return false;
    if (to && row.createdAt > to) return false;
    if (q) {
      const hay = `${row.action} ${row.targetId ?? ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });
}

const adminGetLogs = http.get(`${BASE}/admin/logs`, ({ request }) => {
  const gate = requirePermission(request, 'logs.view');
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20'), 100);
  const cursor = url.searchParams.get('cursor');

  // Keyset over the BigInt PK, newest first (ids descend through the fixture).
  const all = filterAuditLogs(url);
  const start = cursor ? all.findIndex((r) => r.id === cursor) + 1 : 0;
  const page = all.slice(start, start + limit);
  const nextCursor = start + limit < all.length ? (page[page.length - 1]?.id ?? null) : null;

  // Reading the audit log is itself an audited event — watching the watchers.
  writeAudit({
    module: 'Admin',
    action: 'logs.viewed',
    actorUserId: gate.user.id,
    actorRole: gate.user.role,
    targetType: null,
    targetId: null,
    status: 'SUCCESS',
    meta: { returned: page.length },
  });

  return HttpResponse.json({ data: page, nextCursor });
});

const adminExportLogs = http.get(`${BASE}/admin/logs/export`, ({ request }) => {
  // A SEPARATE, higher grant than logs.view: reading a page on screen and
  // walking out with the whole table are different acts. MODERATOR has
  // logs.view but NOT logs.export → this 403s for them.
  const gate = requirePermission(request, 'logs.export');
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  // The documented bounds — an unbounded export of an append-only audit table
  // is a memory incident waiting to happen.
  if (from && to) {
    const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
    if (days > LOGS_EXPORT_MAX_RANGE_DAYS) {
      return HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Unprocessable Entity',
          status: 422,
          detail: 'This export is too large. Narrow the date range or filters.',
          code: 'EXPORT_TOO_LARGE',
          meta: { maxRows: LOGS_EXPORT_MAX_ROWS, maxRangeDays: LOGS_EXPORT_MAX_RANGE_DAYS },
        } satisfies ErrorSchema,
        { status: 422 },
      );
    }
  }

  const rows = filterAuditLogs(url);
  if (rows.length > LOGS_EXPORT_MAX_ROWS) {
    return HttpResponse.json(
      {
        type: 'about:blank',
        title: 'Unprocessable Entity',
        status: 422,
        detail: 'This export is too large. Narrow the date range or filters.',
        code: 'EXPORT_TOO_LARGE',
        meta: { maxRows: LOGS_EXPORT_MAX_ROWS, maxRangeDays: LOGS_EXPORT_MAX_RANGE_DAYS },
      } satisfies ErrorSchema,
      { status: 422 },
    );
  }

  const header = 'id,createdAt,module,action,actorUserId,actorRole,targetType,targetId,status';
  const csv = [
    header,
    ...rows.map((r) =>
      [
        r.id,
        r.createdAt,
        r.module,
        r.action,
        r.actorUserId ?? '',
        r.actorRole ?? '',
        r.targetType ?? '',
        r.targetId ?? '',
        r.status,
      ].join(','),
    ),
  ].join('\n');

  // The export writes its own audit row — an export is exactly the kind of event
  // the log exists to record.
  writeAudit({
    module: 'Admin',
    action: 'logs.exported',
    actorUserId: gate.user.id,
    actorRole: gate.user.role,
    targetType: null,
    targetId: null,
    status: 'SUCCESS',
    meta: { rows: rows.length },
  });

  return new HttpResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="audit-log.csv"',
    },
  });
});

// ── The console's navigation source (S6a-F1) ─────────────────────────────────

/**
 * GET /admin/me/permissions — what the CALLER currently holds.
 *
 * NO permission gate: self-introspection cannot require a grant, or a role with
 * nothing could not even discover that. The gate is just "is this an admin role".
 *
 * Derived from `db.rolePermissions` — the LIVE store Screen 27 writes to, not a
 * frozen constant. That is the whole point: flip a cell via PATCH
 * /admin/roles/matrix and the affected role's permission set here changes on the
 * next fetch, with no role change and no restart. A nav built on this therefore
 * tracks the matrix; a nav built on the role name would not.
 */
const adminMePermissions = http.get(`${BASE}/admin/me/permissions`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
  }
  if (!(ADMIN_ROLES as string[]).includes(user.role)) {
    return errorResponse(
      403,
      'FORBIDDEN',
      'Forbidden',
      'This endpoint is for admin-console roles only.',
    );
  }

  const permissions = db.rolePermissions
    .filter((c) => c.role === user.role && c.enabled)
    .map((c) => c.permission);

  return HttpResponse.json({ data: { role: user.role, permissions } });
});

// ── Admin dashboard ──────────────────────────────────────────────────────────

const adminDashboard = http.get(`${BASE}/admin/dashboard`, ({ request }) => {
  const gate = requirePermission(request, 'reports.view');
  if (gate.error) return gate.error;

  const countBy = <T extends string>(items: T[]) =>
    items.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});

  const employers = countBy([...db.employers.values()].map((c) => c.status));
  const jobs = countBy([...db.jobs.values()].map((j) => j.status));
  const applications = countBy([...db.applications.values()].map((a) => a.status));

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const revenueThisMonthSubunits = [...db.orders.values()]
    .filter((o) => o.status === 'PAID' && new Date(o.createdAt) >= startOfMonth)
    .reduce((sum, o) => sum + o.totalSubunits, 0);

  return HttpResponse.json({
    data: {
      counts: {
        candidates: [...db.candidates.values()].filter(
          (c) => !db.candidateLifecycle.get(c.profile.id)?.purgedAt,
        ).length,
        employers,
        jobs,
        applications,
      },
      revenueThisMonthSubunits,
      currency: 'INR',
      pendingEmployerReviews: [...db.employers.values()].filter((c) => c.status === 'PENDING')
        .length,
      pendingJobReviews: [...db.jobs.values()].filter((j) => j.status === 'PENDING_REVIEW').length,
    },
  });
});

// ── Screen 27: the RBAC matrix ───────────────────────────────────────────────

const adminGetRolesMatrix = http.get(`${BASE}/admin/roles/matrix`, ({ request }) => {
  const gate = requirePermission(request, 'roles.view');
  if (gate.error) return gate.error;

  return HttpResponse.json({
    data: {
      roles: ADMIN_ROLES,
      permissions: ALL_PERMISSION_KEYS,
      cells: db.rolePermissions,
    },
  });
});

const adminPatchRolesMatrix = http.patch(`${BASE}/admin/roles/matrix`, async ({ request }) => {
  // SUPER_ADMIN-effective: roles.manage is seeded locked-OFF for every other
  // role, so ADMIN/MODERATOR/SUPPORT all get a genuine 403 here.
  const gate = requirePermission(request, 'roles.manage');
  if (gate.error) return gate.error;

  const body = (await request.json()) as {
    role: string;
    permission: PermissionKey;
    enabled: boolean;
  };

  const cell = db.rolePermissions.find(
    (c) => c.role === body.role && c.permission === body.permission,
  );
  if (!cell) {
    return errorResponse(404, 'PERMISSION_NOT_FOUND', 'Not found', 'No such role/permission cell.');
  }

  // A locked cell is IMMUTABLE — and the guard is server-side, because a
  // disabled checkbox is not a security control. NO write occurs.
  if (cell.locked) {
    return HttpResponse.json(
      {
        type: 'about:blank',
        title: 'Locked',
        status: 423,
        detail: 'This permission is locked and cannot be changed.',
        code: 'PERMISSION_CELL_LOCKED',
      } satisfies ErrorSchema,
      { status: 423 },
    );
  }

  // The two guardrails S6a-B2 enforces, ADDED IN S6a-F3 so the UI is built
  // against the real answers (checked in the API's order: locked, then these):
  //
  // Self-lockout: the caller must not revoke their own ability to manage roles.
  if (!body.enabled && body.permission === 'roles.manage' && gate.user.role === body.role) {
    return errorResponse(
      422,
      'SELF_LOCKOUT_FORBIDDEN',
      'Unprocessable',
      'You cannot revoke your own ability to manage roles.',
    );
  }
  // Last manager: never let the final roles.manage holder lose it.
  if (!body.enabled && body.permission === 'roles.manage') {
    const remaining = db.rolePermissions.filter(
      (c) => c.permission === 'roles.manage' && c.enabled && c.role !== body.role,
    );
    if (remaining.length === 0) {
      return errorResponse(
        422,
        'LAST_MANAGER_FORBIDDEN',
        'Unprocessable',
        'At least one role must retain the ability to manage roles.',
      );
    }
  }

  // No-op writes return 200 with no audit row — a trail of non-events is noise.
  if (cell.enabled === body.enabled) {
    return HttpResponse.json({ data: cell });
  }

  const from = cell.enabled;
  cell.enabled = body.enabled;

  writeAudit({
    module: 'Admin',
    action: 'rbac.permission.changed',
    actorUserId: gate.user.id,
    actorRole: gate.user.role,
    targetType: 'RolePermission',
    targetId: `${body.role}/${body.permission}`,
    status: 'SUCCESS',
    meta: { role: body.role, permission: body.permission, from, to: body.enabled },
  });

  return HttpResponse.json({ data: cell });
});

// ── Screen 24: employer certificate access ───────────────────────────────────

const adminEmployerCertificateUrl = http.get(
  `${BASE}/admin/employers/:id/certificate/url`,
  ({ request, params }) => {
    const gate = requirePermission(request, 'employers.view');
    if (gate.error) return gate.error;

    const companyId = params['id'] as string;
    const company = [...db.employers.values()].find((c) => c.id === companyId);
    // Nonexistent company and "no certificate on file" are indistinguishable.
    if (!company?.registrationCertKey) {
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Not found.');
    }

    // Audited per issuance — the key and the URL never enter the audit meta.
    writeAudit({
      module: 'Employer',
      action: 'document.viewed',
      actorUserId: gate.user.id,
      actorRole: gate.user.role,
      targetType: 'CompanyDocument',
      targetId: companyId,
      status: 'SUCCESS',
      meta: { documentType: 'REGISTRATION_CERT', companyId },
    });

    return HttpResponse.json({
      data: {
        url: `https://r2.mock.skillindiaconnect.example/certs/${companyId}.pdf?sig=mock&exp=300`,
        expiresInSeconds: 300,
      },
    });
  },
);

// ── Screen 25: admin candidates + purge ──────────────────────────────────────

/** Admin-context card: fuller than the employer view, but NEVER a document key. */
function toAdminCandidateCard(c: MockCandidateShape): AdminCandidateCardSchema {
  const p = c.profile;
  const user = db.users.get(c.userId);
  const life = db.candidateLifecycle.get(p.id) ?? { deletionDueAt: null, purgedAt: null };
  return {
    id: p.id,
    userId: c.userId,
    fullName: p.fullName,
    phone: p.phone ?? null,
    email: p.email ?? null,
    status: user?.status ?? 'ACTIVE',
    profileVisible: p.profileVisible ?? true,
    completionPct: p.completionPct ?? 0,
    // Upload STATUS only — the admin card carries no keys or URLs; content is a
    // separate, per-issuance-audited grant. The contract's shape carries
    // passport VALIDITY, not the raw expiry date.
    documents: (p.documents ?? []).map((d) => ({
      type: d.type,
      uploaded: true,
      ...(d.type === 'PASSPORT' && d.expiryDate
        ? { passportValid: new Date(d.expiryDate).getTime() > Date.now() }
        : {}),
    })),
    deletionDueAt: life.deletionDueAt,
    purgedAt: life.purgedAt,
    createdAt: p.createdAt ?? new Date().toISOString(),
  } as AdminCandidateCardSchema;
}

const adminGetCandidates = http.get(`${BASE}/admin/candidates`, ({ request }) => {
  const gate = requirePermission(request, 'candidates.view');
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
  const search = url.searchParams.get('search')?.toLowerCase();
  const status = url.searchParams.get('status');
  const visibility = url.searchParams.get('visibility');

  let rows = [...db.candidates.values()].map(toAdminCandidateCard);
  if (search) {
    rows = rows.filter((r) =>
      `${r.fullName} ${r.email ?? ''} ${r.phone ?? ''}`.toLowerCase().includes(search),
    );
  }
  if (status) rows = rows.filter((r) => r.status === status);
  if (visibility != null) rows = rows.filter((r) => r.profileVisible === (visibility === 'true'));

  return HttpResponse.json(offsetPaginate(rows, page, pageSize));
});

// ADDED IN S6b-B1 (contract 0.7.0): the review panel's single-candidate view.
// Card + experiences + skills + applicationCount. Purged tombstones ARE
// returned; admins are not subject to profileVisible.
const adminGetCandidate = http.get(`${BASE}/admin/candidates/:id`, ({ request, params }) => {
  const gate = requirePermission(request, 'candidates.view');
  if (gate.error) return gate.error;

  const candidate = [...db.candidates.values()].find((c) => c.profile.id === params['id']);
  if (!candidate) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate not found.');

  const applicationCount = [...db.applications.values()].filter(
    (a) => a.candidateId === candidate.userId || a.candidateId === candidate.profile.id,
  ).length;

  return HttpResponse.json({
    data: {
      ...toAdminCandidateCard(candidate),
      experiences: candidate.profile.experiences ?? [],
      skills: candidate.profile.skills ?? [],
      applicationCount,
    },
  });
});

const adminSuspendCandidate = http.post(
  `${BASE}/admin/candidates/:id/suspend`,
  async ({ request, params }) => {
    const gate = requirePermission(request, 'candidates.edit');
    if (gate.error) return gate.error;

    const candidate = [...db.candidates.values()].find((c) => c.profile.id === params['id']);
    if (!candidate) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate not found.');

    const body = (await request.json()) as { reason?: string };
    if (!body.reason?.trim()) {
      // 400 like the REAL global ValidationPipe (S6b-B1 drift fix — DTO
      // validation failures are BadRequest, not 422; 422s are reserved for
      // semantic codes like PURGE_NOT_CONFIRMED).
      return errorResponse(
        400,
        'VALIDATION_ERROR',
        'Validation failed',
        'A reason is required to suspend a candidate.',
      );
    }

    // S6b-B1 guards: a purged tombstone can never be suspended, and suspending
    // a PENDING_DELETION user would silently cancel a DPDP erasure.
    if (db.candidateLifecycle.get(candidate.profile.id)?.purgedAt) {
      return errorResponse(409, 'CANDIDATE_PURGED', 'Conflict', 'This candidate has been purged.');
    }
    const user = db.users.get(candidate.userId);
    if (user && user.status !== 'ACTIVE') {
      return errorResponse(
        409,
        'CANDIDATE_NOT_ACTIVE',
        'Conflict',
        'Only an active candidate can be suspended.',
      );
    }
    if (user) user.status = 'SUSPENDED';

    writeAudit({
      module: 'Candidate',
      action: 'candidate.suspended',
      actorUserId: gate.user.id,
      actorRole: gate.user.role,
      targetType: 'CandidateProfile',
      targetId: candidate.profile.id,
      status: 'SUCCESS',
      meta: { reason: body.reason },
    });

    return HttpResponse.json({ data: toAdminCandidateCard(candidate) });
  },
);

const adminReactivateCandidate = http.post(
  `${BASE}/admin/candidates/:id/reactivate`,
  ({ request, params }) => {
    const gate = requirePermission(request, 'candidates.edit');
    if (gate.error) return gate.error;

    const candidate = [...db.candidates.values()].find((c) => c.profile.id === params['id']);
    if (!candidate) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate not found.');

    // The purge is irreversible — a tombstone can never be brought back.
    if (db.candidateLifecycle.get(candidate.profile.id)?.purgedAt) {
      return errorResponse(
        409,
        'CANDIDATE_PURGED',
        'Conflict',
        'This candidate has been purged and cannot be reactivated.',
      );
    }

    // S6b-B1 guard: reactivation is SUSPENDED → ACTIVE only — it is not a
    // deletion-cancel path.
    const user = db.users.get(candidate.userId);
    if (user && user.status !== 'SUSPENDED') {
      return errorResponse(
        409,
        'CANDIDATE_NOT_SUSPENDED',
        'Conflict',
        'Only a suspended candidate can be reactivated.',
      );
    }
    if (user) user.status = 'ACTIVE';

    writeAudit({
      module: 'Candidate',
      action: 'candidate.reactivated',
      actorUserId: gate.user.id,
      actorRole: gate.user.role,
      targetType: 'CandidateProfile',
      targetId: candidate.profile.id,
      status: 'SUCCESS',
      meta: {},
    });

    return HttpResponse.json({ data: toAdminCandidateCard(candidate) });
  },
);

const adminCandidateDocumentUrl = http.get(
  `${BASE}/admin/candidates/:id/documents/:type/url`,
  ({ request, params }) => {
    // Decision 5: admins read candidate DOCUMENTS — behind its own key, because
    // this is the DPDP who-saw-whose-passport trail. MODERATOR/SUPPORT are OFF.
    const gate = requirePermission(request, 'candidates.view_documents');
    if (gate.error) return gate.error;

    const candidate = [...db.candidates.values()].find((c) => c.profile.id === params['id']);
    const type = params['type'] as string;
    const doc = candidate?.profile.documents?.find((d) => d.type === type);

    // ONE 404 for all three causes: no such candidate, purged (documents gone),
    // or this type never uploaded. Admins are NOT subject to profileVisible.
    const purged = candidate && db.candidateLifecycle.get(candidate.profile.id)?.purgedAt;
    if (!candidate || purged || !doc) {
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Not found.');
    }

    writeAudit({
      module: 'Candidate',
      action: 'document.viewed',
      actorUserId: gate.user.id,
      actorRole: gate.user.role,
      targetType: 'CandidateDocument',
      targetId: candidate.profile.id,
      status: 'SUCCESS',
      // The TYPE — never the key, never the signed URL.
      meta: { documentType: type, candidateId: candidate.profile.id },
    });

    return HttpResponse.json({
      data: {
        url: `https://r2.mock.skillindiaconnect.example/docs/${candidate.profile.id}/${type}.pdf?sig=mock&exp=300`,
        expiresInSeconds: 300,
      },
    });
  },
);

const adminPurgeCandidate = http.post(
  `${BASE}/admin/candidates/:id/purge`,
  async ({ request, params }) => {
    // SUPER_ADMIN-effective (candidates.delete is OFF for ADMIN, locked OFF for
    // SUPPORT) — an ADMIN calling this gets a real 403.
    const gate = requirePermission(request, 'candidates.delete');
    if (gate.error) return gate.error;

    const candidate = [...db.candidates.values()].find((c) => c.profile.id === params['id']);
    if (!candidate) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Candidate not found.');

    if (db.candidateLifecycle.get(candidate.profile.id)?.purgedAt) {
      return errorResponse(
        409,
        'CANDIDATE_ALREADY_PURGED',
        'Conflict',
        'This candidate has already been purged.',
      );
    }

    const body = (await request.json()) as { reason?: string; confirm?: boolean };
    // A mis-click must never anonymize a human being.
    if (body.confirm !== true || !body.reason?.trim()) {
      return errorResponse(
        422,
        'PURGE_NOT_CONFIRMED',
        'Unprocessable Entity',
        'Purge requires an explicit confirmation and a reason.',
      );
    }

    // THE TOMBSTONE. Anonymize in place — the row survives so financial records
    // and audit rows keep referential integrity, and any applicant card
    // referencing this candidate now exercises the S4 null-candidate path.
    const now = new Date().toISOString();
    const p = candidate.profile;
    const docCount = p.documents?.length ?? 0; // captured BEFORE the erasure
    p.fullName = 'Deleted user';
    p.phone = undefined;
    p.email = `purged-${candidate.userId}@deleted.invalid`;
    p.documents = [];
    p.profileVisible = false;
    db.candidateLifecycle.set(p.id, { deletionDueAt: null, purgedAt: now });

    const user = db.users.get(candidate.userId);
    if (user) {
      user.status = 'PENDING_DELETION';
      user.email = `purged-${candidate.userId}@deleted.invalid`;
    }

    // S6b-B1: the REAL pipeline writes TWO rows — the admin's REQUEST
    // (transactional with the state change) and the worker's COMPLETION
    // (counts only, never PII). The mock purge is synchronous, so both land
    // here back-to-back under the real action names.
    writeAudit({
      module: 'Candidate',
      action: 'admin.candidate.purge_requested',
      actorUserId: gate.user.id,
      actorRole: gate.user.role,
      targetType: 'User',
      targetId: candidate.userId,
      status: 'SUCCESS',
      meta: { reason: body.reason, candidateId: p.id, trigger: 'admin' },
    });
    writeAudit({
      module: 'Candidate',
      action: 'account.purged',
      actorUserId: gate.user.id,
      actorRole: gate.user.role,
      targetType: 'User',
      targetId: candidate.userId,
      status: 'SUCCESS',
      // COUNTS ONLY — the audit row must not preserve what the purge destroyed.
      meta: {
        trigger: 'admin',
        reason: body.reason,
        documentsDeleted: docCount,
        objectsDestroyed: docCount,
      },
    });

    return HttpResponse.json({ data: { purgeScheduledFor: now } }, { status: 202 });
  },
);

// ── Screen 26: admin jobs ────────────────────────────────────────────────────

function toAdminJobRow(job: MockJobShape): AdminJobRowSchema {
  const meta = db.jobAdminMeta.get(job.id) ?? {
    humanId: `JB-2026-${job.id}`,
    isFeatured: false,
    isUrgent: false,
  };
  const applicantCount = [...db.applications.values()].filter((a) => a.jobId === job.id).length;
  return {
    id: job.id,
    humanId: meta.humanId,
    title: job.title,
    companyId: job.companyId,
    companyName: job.companyName,
    market: (job as { market?: string }).market ?? 'GULF',
    status: job.status,
    isFeatured: meta.isFeatured,
    isUrgent: meta.isUrgent,
    applicantCount,
    views: (job as { views?: number }).views ?? 0,
    moderationReason: meta.moderationReason ?? null,
    publishedAt: job.publishedAt ?? null,
    createdAt: job.createdAt,
  } as AdminJobRowSchema;
}

const adminGetJobs = http.get(`${BASE}/admin/jobs`, ({ request }) => {
  const gate = requirePermission(request, 'jobs.view');
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
  const status = url.searchParams.get('status');
  const employerId = url.searchParams.get('employerId');
  const search = url.searchParams.get('search')?.toLowerCase();

  // EVERY status — including DRAFT and PENDING_REVIEW, which no employer-facing
  // or public list returns. That is what makes the moderation queue possible.
  const featured = url.searchParams.get('featured');
  const urgent = url.searchParams.get('urgent');

  let rows = [...db.jobs.values()].map(toAdminJobRow);
  if (status) rows = rows.filter((r) => r.status === status);
  if (employerId) rows = rows.filter((r) => r.companyId === employerId);
  if (featured != null) rows = rows.filter((r) => r.isFeatured === (featured === 'true'));
  if (urgent != null) rows = rows.filter((r) => r.isUrgent === (urgent === 'true'));
  if (search) {
    rows = rows.filter((r) => `${r.title} ${r.companyName}`.toLowerCase().includes(search));
  }

  return HttpResponse.json(offsetPaginate(rows, page, pageSize));
});

// GET /admin/jobs/:id — the moderation detail (0.8.1): the FULL job for ANY
// status (the public detail is ACTIVE-only, so a PENDING_REVIEW job has no
// other read surface) + companyStatus for the pre-emptive suspended warning.
const adminGetJobDetail = http.get(`${BASE}/admin/jobs/:id`, ({ request, params }) => {
  const gate = requirePermission(request, 'jobs.view');
  if (gate.error) return gate.error;

  const job = db.jobs.get(params['id'] as string);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');

  const company = [...db.employers.values()].find((c) => c.id === job.companyId);
  const detail: AdminJobDetailSchema = {
    ...toAdminJobRow(job),
    market: job.market ?? 'GULF',
    location: job.location,
    description: job.description,
    categoryId: job.categoryId ?? null,
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    salaryCurrency: job.salaryCurrency,
    accommodation: job.accommodation,
    healthInsurance: job.healthInsurance,
    transportation: job.transportation,
    requirements: job.requirements ?? [],
    experienceRequiredYears: job.experienceRequiredYears ?? null,
    vacancies: job.vacancies ?? null,
    genderPreference: job.genderPreference ?? 'ANY',
    workConditions: job.workConditions,
    companyStatus: company?.status ?? 'APPROVED',
    archivedAt: job.archivedAt ?? null,
  };
  return HttpResponse.json({ data: detail });
});

const adminReviewJob = http.post(`${BASE}/admin/jobs/:id/review`, async ({ request, params }) => {
  const gate = requirePermission(request, 'jobs.moderate');
  if (gate.error) return gate.error;

  const job = db.jobs.get(params['id'] as string);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');

  if (job.status !== 'PENDING_REVIEW') {
    return errorResponse(
      409,
      'JOB_NOT_PENDING_REVIEW',
      'Conflict',
      'This job is not awaiting review.',
    );
  }

  const body = (await request.json()) as { decision?: string; reason?: string };
  if (body.decision === 'REJECT' && !body.reason?.trim()) {
    return errorResponse(
      422,
      'REVIEW_REASON_REQUIRED',
      'Unprocessable Entity',
      'A reason is required when rejecting a job.',
    );
  }

  const meta = db.jobAdminMeta.get(job.id) ?? {
    humanId: `JB-2026-${job.id}`,
    isFeatured: false,
    isUrgent: false,
  };

  if (body.decision === 'APPROVE') {
    // S6b-B2: approval RE-RUNS the publish gate ladder — the world may have
    // moved while the job sat in review. Rung 1: the employer must still be
    // APPROVED (they can be suspended mid-review).
    const company = [...db.employers.values()].find((c) => c.id === job.companyId);
    if (company && company.status !== 'APPROVED') {
      return errorResponse(
        403,
        'EMPLOYER_NOT_APPROVED',
        'Forbidden',
        'The employer is no longer approved.',
      );
    }
    // Rung 2: worker protection, re-read from the live settings (a rule can be
    // switched back ON during review). Rung 3 (quota) is not simulated here.
    const requiredKeys = [
      'worker_protection.accommodation_required',
      'worker_protection.health_insurance_required',
      'worker_protection.transportation_required',
    ] as const;
    const fields = ['accommodation', 'healthInsurance', 'transportation'] as const;
    const violations = fields.filter((field, i) => {
      const rule = db.settings.find((s) => s.key === requiredKeys[i]);
      return rule?.value === true && (job as Record<string, unknown>)[field] === false;
    });
    if (violations.length > 0) {
      return HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Unprocessable Entity',
          status: 422,
          detail: 'Worker protection rules must all be met.',
          code: 'WORKER_PROTECTION_VIOLATION',
          meta: { violations },
        } satisfies ErrorSchema,
        { status: 422 },
      );
    }

    job.status = 'ACTIVE';
    job.publishedAt = new Date().toISOString();
    meta.moderationReason = null;
  } else {
    // Back to DRAFT with the reason, so the employer can fix and resubmit.
    job.status = 'DRAFT';
    meta.moderationReason = body.reason ?? null;
  }
  db.jobAdminMeta.set(job.id, meta);

  writeAudit({
    module: 'Jobs',
    action: body.decision === 'APPROVE' ? 'job.review.approved' : 'job.review.rejected',
    actorUserId: gate.user.id,
    actorRole: gate.user.role,
    targetType: 'Job',
    targetId: job.id,
    status: 'SUCCESS',
    meta: { decision: body.decision, ...(body.reason ? { reason: body.reason } : {}) },
  });

  return HttpResponse.json({ data: toAdminJobRow(job) });
});

const adminPauseJob = http.post(`${BASE}/admin/jobs/:id/pause`, ({ request, params }) => {
  const gate = requirePermission(request, 'jobs.moderate');
  if (gate.error) return gate.error;

  const job = db.jobs.get(params['id'] as string);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');
  if (job.status !== 'ACTIVE') {
    return errorResponse(409, 'ILLEGAL_JOB_TRANSITION', 'Conflict', 'Only ACTIVE jobs can pause.');
  }

  job.status = 'PAUSED';
  writeAudit({
    module: 'Jobs',
    action: 'job.paused',
    actorUserId: gate.user.id,
    actorRole: gate.user.role,
    targetType: 'Job',
    targetId: job.id,
    status: 'SUCCESS',
    meta: { by: 'admin' },
  });
  return HttpResponse.json({ data: toAdminJobRow(job) });
});

const adminArchiveJob = http.post(`${BASE}/admin/jobs/:id/archive`, ({ request, params }) => {
  const gate = requirePermission(request, 'jobs.moderate');
  if (gate.error) return gate.error;

  const job = db.jobs.get(params['id'] as string);
  if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');
  if (job.status === 'ARCHIVED') {
    return errorResponse(409, 'ILLEGAL_JOB_TRANSITION', 'Conflict', 'Job is already archived.');
  }

  job.status = 'ARCHIVED';
  job.archivedAt = new Date().toISOString();
  writeAudit({
    module: 'Jobs',
    action: 'job.archived',
    actorUserId: gate.user.id,
    actorRole: gate.user.role,
    targetType: 'Job',
    targetId: job.id,
    status: 'SUCCESS',
    meta: { by: 'admin' },
  });
  return HttpResponse.json({ data: toAdminJobRow(job) });
});

const adminPatchJobFlags = http.patch(
  `${BASE}/admin/jobs/:id/flags`,
  async ({ request, params }) => {
    const gate = requirePermission(request, 'jobs.moderate');
    if (gate.error) return gate.error;

    const job = db.jobs.get(params['id'] as string);
    if (!job) return errorResponse(404, 'NOT_FOUND', 'Not found', 'Job not found.');

    const body = (await request.json()) as { featured?: boolean; urgent?: boolean };
    if (body.featured === undefined && body.urgent === undefined) {
      return errorResponse(
        422,
        'VALIDATION_ERROR',
        'Validation failed',
        'Provide at least one of: featured, urgent.',
      );
    }
    const meta = db.jobAdminMeta.get(job.id) ?? {
      humanId: `JB-2026-${job.id}`,
      isFeatured: false,
      isUrgent: false,
    };
    // ADMIN-SET ONLY (decision 3) — the employer can never reach this. Omitted
    // fields stay unchanged.
    if (body.featured !== undefined) meta.isFeatured = body.featured;
    if (body.urgent !== undefined) meta.isUrgent = body.urgent;
    db.jobAdminMeta.set(job.id, meta);

    writeAudit({
      module: 'Jobs',
      action: 'job.flags.changed',
      actorUserId: gate.user.id,
      actorRole: gate.user.role,
      targetType: 'Job',
      targetId: job.id,
      status: 'SUCCESS',
      meta: { isFeatured: meta.isFeatured, isUrgent: meta.isUrgent },
    });

    return HttpResponse.json({ data: toAdminJobRow(job) });
  },
);

const adminCreateJobOnBehalf = http.post(`${BASE}/admin/jobs`, async ({ request }) => {
  const gate = requirePermission(request, 'jobs.post_admin');
  if (gate.error) return gate.error;

  const body = (await request.json()) as Record<string, unknown> & {
    employerId?: string;
    publish?: boolean;
  };
  const company = [...db.employers.values()].find((c) => c.id === body.employerId);
  if (!company) {
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'Employer not found.');
  }

  // S6b-B2 parity: the job record is CREATED FIRST (a draft is always allowed),
  // and the publish gates run against it afterwards — a gate failure leaves an
  // honest DRAFT behind, exactly like the real AdminJobsService.
  const id = `job-admin-${Date.now()}`;
  const publishNow = body.publish === true;
  const job = {
    ...(body as object),
    id,
    status: 'DRAFT',
    companyId: company.id,
    companyName: company.name,
    createdAt: new Date().toISOString(),
    publishedAt: null,
    archivedAt: null,
  } as MockJobShape;
  db.jobs.set(id, job);
  db.jobAdminMeta.set(id, {
    humanId: `JB-2026-${String(db.jobs.size).padStart(5, '0')}`,
    isFeatured: false,
    isUrgent: false,
  });

  if (publishNow) {
    // Rung 1: the TARGET employer must be approved.
    if (company.status !== 'APPROVED') {
      return errorResponse(
        403,
        'EMPLOYER_NOT_APPROVED',
        'Forbidden',
        'The target employer is not approved.',
      );
    }
    // Rung 2: worker protection, evaluated against the admin's own payload.
    const violations = (['accommodation', 'healthInsurance', 'transportation'] as const).filter(
      (k) => body[k] === false,
    );
    if (violations.length > 0) {
      return HttpResponse.json(
        {
          type: 'about:blank',
          title: 'Unprocessable Entity',
          status: 422,
          detail: 'Worker protection rules must all be met.',
          code: 'WORKER_PROTECTION_VIOLATION',
          meta: { violations },
        } satisfies ErrorSchema,
        { status: 422 },
      );
    }
    // Gates passed — the admin IS the reviewer: straight to ACTIVE, never
    // PENDING_REVIEW.
    job.status = 'ACTIVE';
    job.publishedAt = new Date().toISOString();
  }

  writeAudit({
    module: 'Jobs',
    action: 'job.created_onbehalf',
    actorUserId: gate.user.id,
    actorRole: gate.user.role,
    targetType: 'Job',
    targetId: id,
    status: 'SUCCESS',
    meta: { companyId: company.id, postedByAdminId: gate.user.id },
  });

  return HttpResponse.json({ data: job }, { status: 201 });
});

// ── Screen 26: internal notes + the manual WhatsApp resend ───────────────────

const adminGetNotes = http.get(`${BASE}/admin/applications/:id/notes`, ({ request, params }) => {
  const gate = requirePermission(request, 'applications.notes');
  if (gate.error) return gate.error;

  const appId = params['id'] as string;
  if (!db.applications.has(appId)) {
    return errorResponse(404, 'NOT_FOUND', 'Not found', 'Application not found.');
  }
  // INTERNAL ONLY — these never appear on any candidate or employer surface.
  return HttpResponse.json({ data: db.applicationNotes.get(appId) ?? [] });
});

const adminPostNote = http.post(
  `${BASE}/admin/applications/:id/notes`,
  async ({ request, params }) => {
    const gate = requirePermission(request, 'applications.notes');
    if (gate.error) return gate.error;

    const appId = params['id'] as string;
    if (!db.applications.has(appId)) {
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Application not found.');
    }

    const body = (await request.json()) as { body?: string };
    if (!body.body?.trim()) {
      // DTO validation is 400 VALIDATION_ERROR in the real API (global pipe).
      return errorResponse(400, 'VALIDATION_ERROR', 'Bad Request', 'A note body is required.');
    }

    const note = {
      id: `note-${Date.now()}`,
      authorUserId: gate.user.id,
      authorRole: gate.user.role,
      body: body.body,
      createdAt: new Date().toISOString(),
    } as NoteEntrySchema;

    const notes = db.applicationNotes.get(appId) ?? [];
    notes.push(note);
    db.applicationNotes.set(appId, notes);

    return HttpResponse.json({ data: note }, { status: 201 });
  },
);

const adminDeleteNote = http.delete(
  `${BASE}/admin/applications/:id/notes/:noteId`,
  ({ request, params }) => {
    const gate = requirePermission(request, 'applications.notes');
    if (gate.error) return gate.error;

    const appId = params['id'] as string;
    const noteId = params['noteId'] as string;
    const notes = db.applicationNotes.get(appId) ?? [];
    const idx = notes.findIndex((n) => n.id === noteId);
    if (idx === -1) {
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Note not found.');
    }
    // S6b-B2 rule: the author may delete their own note; SUPER_ADMIN any note.
    const note = notes[idx]!;
    if (note.authorUserId !== gate.user.id && gate.user.role !== 'SUPER_ADMIN') {
      return errorResponse(
        403,
        'NOT_NOTE_AUTHOR',
        'Forbidden',
        'Only the author can delete this note.',
      );
    }
    notes.splice(idx, 1);
    db.applicationNotes.set(appId, notes);
    return new HttpResponse(null, { status: 204 });
  },
);

const adminResendWhatsapp = http.post(
  `${BASE}/admin/applications/:id/resend-whatsapp`,
  async ({ request, params }) => {
    const gate = requirePermission(request, 'applications.change_status');
    if (gate.error) return gate.error;

    const appId = params['id'] as string;
    const application = db.applications.get(appId);
    if (!application) {
      return errorResponse(404, 'NOT_FOUND', 'Not found', 'Application not found.');
    }

    // S6b-B2: a reason is MANDATORY — consistent with every admin corrective
    // action (reject, suspend, override, purge).
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    if (!body.reason?.trim()) {
      // DTO validation is 400 VALIDATION_ERROR in the real API (global pipe).
      return errorResponse(
        400,
        'VALIDATION_ERROR',
        'Bad Request',
        'A reason is required to resend the WhatsApp.',
      );
    }

    // The bypassGuard seam is SELECTED-only: resending "you've been selected" to
    // someone who wasn't is the exact harm the once-per-application guard exists
    // to prevent.
    if (application.status !== 'SELECTED') {
      return errorResponse(
        422,
        'APPLICATION_NOT_SELECTED',
        'Unprocessable Entity',
        'Only SELECTED applications can have the WhatsApp resent.',
      );
    }

    const sends = db.whatsappResends.get(appId) ?? [];
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = sends.filter((t) => new Date(t).getTime() > dayAgo);
    if (recent.length >= RESEND_WHATSAPP_CAP) {
      return errorResponse(
        429,
        'RATE_LIMITED',
        'Too Many Requests',
        'This application has reached its resend limit. Try again later.',
      );
    }

    const resentAt = new Date().toISOString();
    recent.push(resentAt);
    db.whatsappResends.set(appId, recent);

    // The honest enqueue-time channel: whatsappCapable=false → the S2-B3
    // downgrade means only email/in-app actually goes out.
    const candidate = [...db.candidates.values()].find(
      (c) => c.userId === application.candidateId || c.profile.id === application.candidateId,
    );
    const whatsappCapable =
      (candidate?.profile as { whatsappCapable?: boolean } | undefined)?.whatsappCapable ?? true;

    // The bypass is never anonymous — the acting admin is on the audit row
    // (reason included; a phone number never is).
    writeAudit({
      module: 'Applications',
      action: 'application.whatsapp.resent',
      actorUserId: gate.user.id,
      actorRole: gate.user.role,
      targetType: 'Application',
      targetId: appId,
      status: 'SUCCESS',
      meta: { reason: body.reason, whatsappCapable, attempt: recent.length },
    });

    return HttpResponse.json(
      { data: { resentAt, channel: whatsappCapable ? 'whatsapp' : 'email_fallback' } },
      { status: 202 },
    );
  },
);

// No `stubNotImplemented` array remains: as of S6 EVERY contract endpoint is
// live in this file. The only deliberate omissions are /webhooks/razorpay and
// /webhooks/stripe — server-to-server, signature-authed, and never reachable
// from browser code (the mocks simulate their EFFECT instead; see the billing
// section).

// ─── Export all handlers ──────────────────────────────────────────────────────

export const handlers = [
  health,
  // Auth
  authSignup,
  authLogin,
  authGoogleInit,
  authGoogleCallback,
  authRefresh,
  authLogout,
  authOtpSend,
  authOtpVerify,
  authLoginPhoneStart,
  authLoginPhoneVerify,
  authForgotPassword,
  authResetPassword,
  // Candidate profile
  candidateMe,
  candidateMePatch,
  candidateMeCompletion,
  candidateMeSettingsPatch,
  candidateExperiencesPost,
  candidateExperiencePatch,
  candidateExperienceDelete,
  candidateSkillsPost,
  candidateSkillDelete,
  candidateDocumentsPresign,
  candidateDocumentsConfirm,
  candidatePhotoPresign,
  candidatePhotoConfirm,
  candidateCompleteOnboarding,
  // S2: Stats + Notifications
  candidateMeStats,
  candidateMeNotifications,
  candidateMeNotificationsRead,
  employerMeNotifications,
  employerMeNotificationsRead,
  // Account
  accountDelete,
  // Resume
  resumeGet,
  resumeSettingsPatch,
  resumeGenerate,
  resumeStatus,
  resumeDownload,
  resumeSendWhatsapp,
  resumeSendEmail,
  // S2: Employer
  employersRegister,
  employersMeCompany,
  employersMeCompanyPatch,
  employersMeCompanyDocumentsPresign,
  employersMeCompanyDocumentsConfirm,
  employersMeDashboard,
  employersMeJobs,
  // S3: Employer profile
  employersMeProfile,
  employersMeProfileHiringPreferencesPatch,
  employersMeProfileContactsPost,
  employersMeProfileContactPatch,
  employersMeProfileContactDelete,
  employersMeProfileLogoPresign,
  employersMeProfileLogoConfirm,
  // S3: Candidate browse + view
  employersCandidatesBrowse,
  employersCandidateView,
  // S3: Candidate profile views
  candidateMeProfileViews,
  // S4: Applications
  applyToJob,
  getJobApplicants,
  patchApplicationStatus,
  candidateMeApplications,
  candidateMeApplicationById,
  adminGetApplications,
  adminGetApplication,
  adminPatchApplicationStatus,
  // S2: Jobs — public
  getJobs,
  getJobById,
  getJobCategories,
  // S2: Jobs — employer CRUD + lifecycle
  postJobs,
  patchJobById,
  publishJob,
  pauseJob,
  resumeJob,
  archiveJob,
  duplicateJob,
  // S2: Jobs — candidate
  saveJob,
  unsaveJob,
  // S2: Admin
  adminGetEmployers,
  adminGetEmployer,
  adminApproveEmployer,
  adminRejectEmployer,
  adminSuspendEmployer,
  adminReactivateEmployer,
  adminGetSettings,
  adminPatchSettings,
  // S5: Billing (webhooks deliberately absent — see the billing section comment)
  billingPlans,
  billingSubscription,
  billingInvoices,
  billingCheckout,
  billingOrderById,
  employersCandidateDocumentUrl,
  // S6: Admin console (RBAC-accurate — each enforces its PermissionKey)
  adminMePermissions,
  adminDashboard,
  adminGetLogs,
  adminExportLogs,
  adminGetRolesMatrix,
  adminPatchRolesMatrix,
  adminEmployerCertificateUrl,
  adminGetCandidates,
  adminGetCandidate,
  adminSuspendCandidate,
  adminReactivateCandidate,
  adminCandidateDocumentUrl,
  adminPurgeCandidate,
  adminGetJobs,
  adminGetJobDetail,
  adminCreateJobOnBehalf,
  adminReviewJob,
  adminPauseJob,
  adminArchiveJob,
  adminPatchJobFlags,
  adminGetNotes,
  adminPostNote,
  adminDeleteNote,
  adminResendWhatsapp,
];
