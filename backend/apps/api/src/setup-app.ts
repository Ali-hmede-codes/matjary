import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { httpMetrics } from '@app/observability';
import { SafeValidationException } from './modules/monitoring/monitoring.filter';

export function setupApp(
  app: NestExpressApplication,
  production: boolean,
): void {
  app.use(
    helmet({
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      strictTransportSecurity: production ? undefined : false,
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'", 'https://accounts.google.com/gsi/client'],
          'connect-src': ["'self'", 'https://accounts.google.com'],
          'frame-src': ['https://accounts.google.com'],
          'style-src': [
            "'self'",
            "'unsafe-inline'",
            'https://accounts.google.com/gsi/style',
          ],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': production ? [] : null,
        },
      },
    }),
  );
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.locals.requestId = randomUUID();
    response.setHeader('X-Request-ID', response.locals.requestId);
    response.setHeader('Cache-Control', 'no-store');
    httpMetrics.observe(request, response);
    if (request.path.startsWith('/api/v1/admin'))
      response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (request.method === 'GET' && request.path === '/') {
      response.redirect('/api/v1/auth/login');
      return;
    }
    next();
  });
  app.setGlobalPrefix('api/v1');
  app.useBodyParser('json', { limit: '16kb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
      exceptionFactory: (errors) => new SafeValidationException(errors),
    }),
  );
}
