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
import { publicInstitute } from './controllers/auth.controller.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:'],
        // Only needed when Google reCAPTCHA is enabled (RECAPTCHA_SITE_KEY/
        // RECAPTCHA_SECRET_KEY set) - harmless to leave allowed otherwise,
        // since nothing loads from these hosts unless the widget is rendered.
        'script-src': ["'self'", 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
        'frame-src': ["'self'", 'https://www.google.com/recaptcha/', 'https://recaptcha.google.com/'],
        'connect-src': ["'self'", 'https://www.google.com/recaptcha/'],
      },
    },
  }));
  if (!env.isProd) app.use(morgan('dev'));
  app.use(express.json({ limit: '50kb' }));
  app.use(cookieParser());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/public/institute', publicInstitute);
  app.use('/api/auth', authRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/admin', adminRoutes);
  // Next phases: /api/employee, /api/super-admin ...

  app.use('/api', notFound);

  // Serve the built React app (npm run build) from the same server in production
  if (fs.existsSync(env.CLIENT_DIST)) {
    app.use(express.static(env.CLIENT_DIST));
    app.get('*', (req, res) => res.sendFile(path.join(env.CLIENT_DIST, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
