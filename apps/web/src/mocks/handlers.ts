import { http, HttpResponse } from 'msw';
import type { components } from '@skillindiaconnect/shared-types';
import {
  db,
  MOCK_OTP,
  NOT_ON_WHATSAPP_PHONE,
  NOT_WHATSAPP_CAPABLE_USER_ID,
  makeAccessToken,
  makeRefreshToken,
  getUserByToken,
  computeCompletion,
} from './data';

type ErrorSchema = components['schemas']['Error'];

const BASE = '/api/v1';

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
  // Enumeration-safe: always 200 regardless of whether an account exists.
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
  // Enumeration-safe: always 200.
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

    // Soft-block: always succeeds even with missing docs.
    return HttpResponse.json({ data: { completionPct: pct } });
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

// ─── Health ───────────────────────────────────────────────────────────────────

const health = http.get('/health', () => {
  return HttpResponse.json({ status: 'ok (mock)' });
});

// ─── Stub catch-all for later-sprint endpoints ────────────────────────────────

const stubNotImplemented = [
  http.post(`${BASE}/employers/register`, notImplemented('Sprint 3')),
  http.get(`${BASE}/employers/me/company`, notImplemented('Sprint 3')),
  http.patch(`${BASE}/employers/me/company`, notImplemented('Sprint 3')),
  http.get(`${BASE}/employers/me/dashboard`, notImplemented('Sprint 3')),
  http.get(`${BASE}/employers/me/jobs`, notImplemented('Sprint 3')),
  http.get(`${BASE}/employers/candidates/:id`, notImplemented('Sprint 3')),
  http.get(`${BASE}/jobs`, notImplemented('Sprint 2')),
  http.post(`${BASE}/jobs`, notImplemented('Sprint 4')),
  http.get(`${BASE}/jobs/:id`, notImplemented('Sprint 2')),
  http.patch(`${BASE}/jobs/:id`, notImplemented('Sprint 4')),
  http.post(`${BASE}/jobs/:id/save`, notImplemented('Sprint 2')),
  http.delete(`${BASE}/jobs/:id/save`, notImplemented('Sprint 2')),
  http.post(`${BASE}/jobs/:id/apply`, notImplemented('Sprint 4')),
  http.post(`${BASE}/jobs/:id/publish`, notImplemented('Sprint 4')),
  http.get(`${BASE}/jobs/:id/applicants`, notImplemented('Sprint 4')),
  http.patch(`${BASE}/applications/:id/status`, notImplemented('Sprint 4')),
  http.get(`${BASE}/billing/plans`, notImplemented('Sprint 5')),
  http.post(`${BASE}/billing/checkout`, notImplemented('Sprint 5')),
  http.get(`${BASE}/billing/subscription`, notImplemented('Sprint 5')),
  http.get(`${BASE}/billing/invoices`, notImplemented('Sprint 5')),
  http.get(`${BASE}/admin/dashboard`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/candidates`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/employers`, notImplemented('Sprint 6')),
  http.post(`${BASE}/admin/employers/:id/approve`, notImplemented('Sprint 6')),
  http.post(`${BASE}/admin/employers/:id/reject`, notImplemented('Sprint 6')),
  http.post(`${BASE}/admin/employers/:id/suspend`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/jobs`, notImplemented('Sprint 6')),
  http.patch(`${BASE}/admin/jobs/:id`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/applications`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/roles/:role/permissions`, notImplemented('Sprint 6')),
  http.patch(`${BASE}/admin/roles/:role/permissions`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/settings`, notImplemented('Sprint 6')),
  http.patch(`${BASE}/admin/settings`, notImplemented('Sprint 6')),
  http.get(`${BASE}/admin/logs`, notImplemented('Sprint 6')),
];

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

// ─── Export all handlers ──────────────────────────────────────────────────────

export const handlers = [
  health,
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
  accountDelete,
  resumeGet,
  resumeSettingsPatch,
  resumeGenerate,
  resumeDownload,
  resumeSendWhatsapp,
  resumeSendEmail,
  ...stubNotImplemented,
];
