import { http, HttpResponse } from 'msw';
import type { components } from '@skillindiaconnect/shared-types';
import {
  db,
  buildProfile,
  MOCK_OTP,
  NOT_ON_WHATSAPP_PHONE,
  NOT_WHATSAPP_CAPABLE_USER_ID,
  makeAccessToken,
  makeRefreshToken,
  getUserByToken,
  computeCompletion,
  toJobCard,
  toJobDetail,
} from './data';
import { MOCK_SSR_ORIGIN } from './ssr-origin';

type ErrorSchema = components['schemas']['Error'];

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
    headers: { Location: '/auth/callback?mock=true' },
  });
});

const authRefresh = http.post(`${BASE}/auth/refresh`, ({ request }) => {
  const cookie = request.headers.get('Cookie') ?? '';
  const match = /sic_refresh=([^;]+)/.exec(cookie);
  if (!match) {
    return errorResponse(
      401,
      'INVALID_REFRESH',
      'Invalid refresh token',
      'Refresh token is missing or expired.',
    );
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

  return HttpResponse.json({
    data: { applied: 3, profileViews: 12, shortlisted: 1 },
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

  const filterMap: Record<string, string[]> = {
    applications: ['APPLICATION_UPDATE'],
    jobs: ['JOB_MATCH'],
    profile: ['PROFILE_REMINDER', 'DOCUMENT_STATUS'],
    system: ['SYSTEM'],
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

  return HttpResponse.json({
    data: { settings: candidate.resumeSettings, lastRenderedAt: candidate.lastRenderedAt },
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
    Object.assign(candidate.resumeSettings, body);

    return HttpResponse.json({ data: candidate.resumeSettings });
  },
);

const resumeGenerate = http.post(`${BASE}/candidates/me/resume/generate`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  const candidate = db.candidates.get(user.id);
  if (candidate) candidate.lastRenderedAt = new Date().toISOString();

  return HttpResponse.json({ data: { generationId: `gen-${Date.now()}` } }, { status: 202 });
});

const resumeDownload = http.get(`${BASE}/candidates/me/resume/download`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  return HttpResponse.json({
    data: {
      url: `https://mock-r2.example.com/resumes/${user.id}/resume.pdf?sig=mock`,
      expiresInSeconds: 300,
    },
  });
});

const resumeSendWhatsapp = http.post(
  `${BASE}/candidates/me/resume/send-whatsapp`,
  ({ request }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

    if (user.id === NOT_WHATSAPP_CAPABLE_USER_ID) {
      return errorResponse(
        409,
        'WHATSAPP_NOT_CAPABLE',
        'WhatsApp not capable',
        'This account is not linked to a WhatsApp number. Please use email delivery.',
      );
    }

    return HttpResponse.json({ data: { sent: true } }, { status: 202 });
  },
);

const resumeSendEmail = http.post(`${BASE}/candidates/me/resume/send-email`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');

  return HttpResponse.json({ data: { sent: true } }, { status: 202 });
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
    registrationCertKey: null,
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

  const dashboard: components['schemas']['EmployerDashboard'] = {
    kpis: { activeJobs, totalApplications: 0, shortlisted: 0, selected: 0 },
    recentJobs: ownJobs
      .filter((j) => j.status === 'ACTIVE')
      .slice(0, 5)
      .map((j) => toJobCard(j, null)),
    recentApplicants: [],
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

  const result = offsetPaginate(jobs, page, pageSize);
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

// ─── S2: Jobs — employer CRUD + lifecycle ────────────────────────────────────

const postJobs = http.post(`${BASE}/jobs`, async ({ request }) => {
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
    salaryCurrency: string;
    accommodation: boolean;
    healthInsurance: boolean;
    transportation: boolean;
  };

  if (!body.title || !body.market || !body.location) {
    return errorResponse(422, 'VALIDATION_ERROR', 'Validation failed', 'Required fields missing.');
  }

  const job = {
    id: `job-${Date.now()}`,
    title: body.title,
    status: 'DRAFT' as const,
    market: body.market,
    location: body.location,
    description: body.description,
    categoryId: body.categoryId ?? null,
    salaryMin: body.salaryMin ?? null,
    salaryMax: body.salaryMax ?? null,
    salaryCurrency: body.salaryCurrency ?? 'AED',
    accommodation: body.accommodation ?? false,
    healthInsurance: body.healthInsurance ?? false,
    transportation: body.transportation ?? false,
    workConditions: body.workConditions,
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

const patchJobById = http.patch(`${BASE}/jobs/:id`, async ({ request, params }) => {
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

const publishJob = http.post(`${BASE}/jobs/:id/publish`, ({ request, params }) => {
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

  // Rule 3: quota (Free = max 1 active job)
  const activeCount = [...db.jobs.values()].filter(
    (j) => j.companyId === company.id && j.status === 'ACTIVE' && j.id !== id,
  ).length;
  if (activeCount >= 1) {
    return errorResponse(
      422,
      'JOB_QUOTA_EXCEEDED',
      'Job quota exceeded',
      'Free plan allows 1 active job. Archive or pause your existing job first.',
      { planLimit: 1, activeCount },
    );
  }

  job.status = 'ACTIVE';
  job.publishedAt = new Date().toISOString();
  return HttpResponse.json({ data: job });
});

const pauseJob = http.post(`${BASE}/jobs/:id/pause`, ({ request, params }) => {
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

const resumeJob = http.post(`${BASE}/jobs/:id/resume`, ({ request, params }) => {
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

const archiveJob = http.post(`${BASE}/jobs/:id/archive`, ({ request, params }) => {
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

const duplicateJob = http.post(`${BASE}/jobs/:id/duplicate`, ({ request, params }) => {
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

const adminGetEmployers = http.get(`${BASE}/admin/employers`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    return errorResponse(403, 'FORBIDDEN', 'Forbidden', 'Admin access required.');
  }

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

const adminApproveEmployer = http.post(
  `${BASE}/admin/employers/:id/approve`,
  ({ request, params }) => {
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      return errorResponse(403, 'FORBIDDEN', 'Forbidden', 'Admin access required.');
    }

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
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      return errorResponse(403, 'FORBIDDEN', 'Forbidden', 'Admin access required.');
    }

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
    const user = getAuthUser(request);
    if (!user)
      return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      return errorResponse(403, 'FORBIDDEN', 'Forbidden', 'Admin access required.');
    }

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

// ─── S2: Admin — platform settings ───────────────────────────────────────────

const adminGetSettings = http.get(`${BASE}/admin/settings`, ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    return errorResponse(403, 'FORBIDDEN', 'Forbidden', 'Admin access required.');
  }

  return HttpResponse.json({ data: db.settings });
});

const adminPatchSettings = http.patch(`${BASE}/admin/settings`, async ({ request }) => {
  const user = getAuthUser(request);
  if (!user)
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized', 'Valid access token required.');
  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    return errorResponse(403, 'FORBIDDEN', 'Forbidden', 'Admin access required.');
  }

  const body = (await request.json()) as { updates: { key: string; value: unknown }[] };

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
    setting.value = update.value;
    setting.updatedAt = new Date().toISOString();
    setting.updatedBy = user.id;
  }

  return HttpResponse.json({ data: db.settings });
});

// ─── Health ───────────────────────────────────────────────────────────────────

const health = http.get('/health', () => {
  return HttpResponse.json({ status: 'ok (mock)' });
});

// ─── Stub catch-all for later-sprint endpoints ────────────────────────────────

function notImplemented(sprint: string) {
  return () =>
    HttpResponse.json(
      {
        type: 'about:blank',
        title: 'Not implemented',
        status: 501,
        detail: `This endpoint is planned for ${sprint}.`,
        code: 'NOT_IMPLEMENTED',
      } satisfies ErrorSchema,
      { status: 501 },
    );
}

const stubNotImplemented = [
  http.get(`${BASE}/employers/candidates/:id`, notImplemented('Sprint 3')),
  http.post(`${BASE}/jobs/:id/apply`, notImplemented('Sprint 4')),
  http.get(`${BASE}/jobs/:id/applicants`, notImplemented('Sprint 4')),
  http.patch(`${BASE}/applications/:id/status`, notImplemented('Sprint 4')),
  http.get(`${BASE}/billing/plans`, notImplemented('Sprint 5')),
  http.post(`${BASE}/billing/checkout`, notImplemented('Sprint 5')),
  http.get(`${BASE}/billing/subscription`, notImplemented('Sprint 5')),
  http.get(`${BASE}/billing/invoices`, notImplemented('Sprint 5')),
  http.get(`${BASE}/admin/dashboard`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/candidates`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/jobs`, notImplemented('Sprint 6')),
  http.patch(`${BASE}/admin/jobs/:id`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/applications`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/roles/:role/permissions`, notImplemented('Sprint 6')),
  http.patch(`${BASE}/admin/roles/:role/permissions`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/logs`, notImplemented('Sprint 6')),
];

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
  candidateCompleteOnboarding,
  // S2: Stats + Notifications
  candidateMeStats,
  candidateMeNotifications,
  candidateMeNotificationsRead,
  // Account
  accountDelete,
  // Resume
  resumeGet,
  resumeSettingsPatch,
  resumeGenerate,
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
  // S2: Jobs — public
  getJobs,
  getJobById,
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
  adminApproveEmployer,
  adminRejectEmployer,
  adminSuspendEmployer,
  adminGetSettings,
  adminPatchSettings,
  // Later-sprint stubs
  ...stubNotImplemented,
];
