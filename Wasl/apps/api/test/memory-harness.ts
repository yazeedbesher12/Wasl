import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { configureApp } from '../src/setup';

export const TEST_PASSWORD = randomBytes(24).toString('base64url');

process.env.NODE_ENV = 'test';
process.env.WASL_STORAGE_DRIVER = 'memory';
process.env.WASL_DEV_PASSWORD = TEST_PASSWORD;
process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
process.env.JWT_REFRESH_SECRET = randomBytes(48).toString('base64url');
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL_DAYS = '1';
process.env.API_PORT = '4001';
process.env.CORS_ORIGINS = 'http://localhost:3000';
delete process.env.DATABASE_URL;
delete process.env.MIGRATION_DATABASE_URL;

export interface TestSession {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    activeSchoolId: string | null;
    activeRole: string;
    membershipId: string;
  };
}

export async function createMemoryApp(): Promise<INestApplication> {
  const { AppModule } = await import('../src/app.module');
  const testingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = testingModule.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export async function login(app: INestApplication, email: string): Promise<TestSession> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: TEST_PASSWORD });
  if (response.status !== 200) throw new Error(`Fictional test login failed with HTTP ${response.status}`);
  return response.body as TestSession;
}

export const bearer = (token: string) => `Bearer ${token}`;
export const developmentId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
