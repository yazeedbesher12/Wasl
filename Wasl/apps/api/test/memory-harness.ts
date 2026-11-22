import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalObjectStore, OBJECT_STORE } from '../src/files/object-store';
import type { FileUploadInput } from '@wasl/shared';
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
  const directory = await mkdtemp(join(tmpdir(), 'wasl-test-files-'));
  const testingModule = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(OBJECT_STORE).useValue(new LocalObjectStore(directory)).compile();
  const app = testingModule.createNestApplication();
  configureApp(app);
  await app.init();
  const close = app.close.bind(app);
  app.close = async () => { try { await close(); } finally { await rm(directory, { recursive: true, force: true }); } };
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

export const TEST_PDF = Buffer.from('%PDF-1.7\nFictional test document\n%%EOF\n');
export async function uploadTestFile(app: INestApplication, auth: string, input: FileUploadInput) {
  let upload = request(app.getHttpServer()).post('/api/v1/files').set('Authorization', auth).field('purpose', input.purpose);
  if (input.lessonId) upload = upload.field('lessonId', input.lessonId);
  if (input.assessmentId) upload = upload.field('assessmentId', input.assessmentId);
  const response = await upload.attach('file', TEST_PDF, { filename: 'worksheet.pdf', contentType: 'application/pdf' });
  if (response.status !== 201) throw new Error(`Test file upload failed: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body as import('@wasl/shared').FileDto;
}
