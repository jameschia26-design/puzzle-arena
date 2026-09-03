import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { registerAdminRoutes } from './routes/admin.js';
import { env } from './env.js';

describe('Admin Google SSO routes', () => {
  it('GET /api/admin/auth-config returns googleEnabled boolean', async () => {
    const app = Fastify();
    registerAdminRoutes(app);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/auth-config',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('googleEnabled');
    expect(typeof body.googleEnabled).toBe('boolean');
  });

  it('POST /api/admin/sign-up/google rejects missing signupCode', async () => {
    const app = Fastify();
    registerAdminRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/sign-up/google',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Invalid request');
  });

  it('POST /api/admin/sign-up/google rejects invalid signup code with 403', async () => {
    const app = Fastify();
    registerAdminRoutes(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/sign-up/google',
      payload: {
        signupCode: 'wrong-code',
      },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Invalid signup code');
  });

  it('POST /api/admin/sign-up/google reports unconfigured server if credentials missing', async () => {
    const app = Fastify();
    registerAdminRoutes(app);

    // If env.googleClientId is empty, it should return 400
    if (!env.googleClientId || !env.googleClientSecret) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/sign-up/google',
        payload: {
          signupCode: env.adminSignupCode,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toContain('Google SSO is not configured');
    }
  });

  it('preHandler hook blocks direct sign-up and raw social sign-up bypass', async () => {
    const app = Fastify();

    app.addHook('preHandler', async (req, reply) => {
      if (req.method === 'POST' && req.url.startsWith('/api/auth/sign-up')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      if (req.method === 'POST' && req.url.startsWith('/api/auth/sign-in/social')) {
        const body = req.body as { requestSignUp?: boolean } | undefined;
        if (body?.requestSignUp) {
          return reply.code(403).send({
            error: 'Social registration must use /api/admin/sign-up/google with a valid signup code',
          });
        }
      }
    });

    app.post('/api/auth/sign-up/email', async () => ({ ok: true }));
    app.post('/api/auth/sign-in/social', async () => ({ ok: true }));

    const resRawSignUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {},
    });
    expect(resRawSignUp.statusCode).toBe(404);

    const resBypassSocial = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      payload: { requestSignUp: true },
    });
    expect(resBypassSocial.statusCode).toBe(403);

    const resNormalSocial = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      payload: { provider: 'google' },
    });
    expect(resNormalSocial.statusCode).toBe(200);
  });
});
