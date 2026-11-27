import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Shared app setup used by main.ts and the tests. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transform: true, validationError: { target: false, value: false } }));
  const config = app.get(ConfigService);
  const trustedProxies = config.getOrThrow<string[]>('WASL_TRUSTED_PROXY_IPS');
  app.getHttpAdapter().getInstance().set('trust proxy', trustedProxies.length ? trustedProxies : false);
  const origins = config.getOrThrow<string>('CORS_ORIGINS').split(',');
  app.enableCors({ origin: origins, credentials: true });
}
