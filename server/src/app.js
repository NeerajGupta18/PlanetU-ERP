import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.routes.js';
import studentRoutes from './routes/student.routes.js';
import adminRoutes from './routes/admin.routes.js';
import employeeRoutes from './routes/employee.routes.js';
import superAdminRoutes from './routes/superadmin.routes.js';
import filesRoutes from './routes/files.routes.js';
import publicRoutes from './routes/public.routes.js';
import { razorpayWebhook } from './controllers/onlinePayments.controller.js';
import { asyncHandler } from './utils/asyncHandler.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'https://*.razorpay.com'],
        // Only needed when Google reCAPTCHA is enabled (RECAPTCHA_SITE_KEY/
        // RECAPTCHA_SECRET_KEY set) - harmless to leave allowed otherwise,
        // since nothing loads from these hosts unless the widget is rendered.
        'script-src': ["'self'", 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/', 'https://checkout.razorpay.com'],
        // Razorpay Checkout (online fee payment) loads its script and opens its payment form in an iframe
        'frame-src': ["'self'", 'https://www.google.com/recaptcha/', 'https://recaptcha.google.com/', 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
        'connect-src': ["'self'", 'https://www.google.com/recaptcha/', 'https://api.razorpay.com', 'https://lumberjack.razorpay.com', 'https://checkout.razorpay.com'],
      },
    },
  }));
  if (!env.isProd) app.use(morgan('dev'));
  // Razorpay webhook: must see the RAW body (its signature covers the exact bytes), so it is mounted
  // before express.json(). It has no session; the HMAC signature is its authentication.
  app.post('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '256kb' }), asyncHandler(razorpayWebhook));
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/employee', employeeRoutes);
  app.use('/api/super-admin', superAdminRoutes);
  app.use('/api/files', filesRoutes);
  app.use('/api/public/:code/admissions', publicRoutes);

  app.use('/api', notFound);

  // Serve the built React app (npm run build) from the same server in production
  if (fs.existsSync(env.CLIENT_DIST)) {
    app.use(express.static(env.CLIENT_DIST));
    app.get('*', (req, res) => res.sendFile(path.join(env.CLIENT_DIST, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
