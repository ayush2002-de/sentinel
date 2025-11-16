// /api/src/app.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http'; // For structured JSON logging
import { z } from 'zod';
import { apiRoutes } from './routes/index.js';
import { metrics } from './Services/MetricsService.js';

// Create the express app
const app = express();

// --- Core Middleware ---

// 1. Security headers with CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// 2. Enable CORS for your frontend
app.use(cors({
  origin: process.env.WEB_URL || 'http://localhost:5173', // Vite dev server
  credentials: true,
}));

// 3. Structured logging
app.use(pinoHttp());

// 4. Parse JSON request bodies
app.use(express.json({ limit: '50mb' })); // Increase limit for large ingests

// 5. Metrics middleware - Track API request latency
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const route = req.route ? req.route.path : req.path;
    metrics.apiRequestLatency
      .labels(req.method, route, res.statusCode.toString())
      .observe(duration);
  });

  next();
});

// --- Routes ---
app.use('/api', apiRoutes);

// --- Error Handling ---
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  req.log.error(err, 'Unhandled error');

  // Handle Zod validation errors
  if (err instanceof z.ZodError) {
    return res.status(400).json({
      name: 'validation_error',
      issues: err.issues,
    });
  }

  // Generic error
  return res.status(500).json({
    name: 'internal_server_error',
    message: 'Something went wrong. Check logs.',
  });
});

export { app };