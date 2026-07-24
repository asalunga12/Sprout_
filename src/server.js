import '../config/env.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, envInt } from '../config/env.js';
import registrationRouter from './routes/registration.js';
import soaRouter from './routes/soa.js';
import webhooksRouter from './routes/webhooks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Shopify webhook needs the RAW body for HMAC verification — mount it BEFORE
// the JSON parser and give it a raw body parser.
app.use('/webhooks', express.raw({ type: '*/*', limit: '2mb' }), webhooksRouter);

// Everything else uses JSON.
app.use(express.json({ limit: '1mb' }));

// Static forms.
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes.
app.use('/api/registrations', registrationRouter);
app.use('/api/soa', soaRouter);

// Health check.
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Central error handler.
app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.message || 'Internal Server Error',
    ...(err.details ? { details: err.details } : {}),
  });
});

const PORT = envInt('PORT', 3000);
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Sprout Event SOA tool listening on :${PORT}`);
    console.log(`  Base URL: ${env('PUBLIC_BASE_URL', `http://localhost:${PORT}`)}`);
    console.log(`  Forms:    http://localhost:${PORT}/`);
  });
}

export default app;
