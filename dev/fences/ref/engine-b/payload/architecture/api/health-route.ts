import { Hono } from 'hono';

export const health = new Hono();

health.get('/api/health', (c) => c.json({ ok: true }, 200));
