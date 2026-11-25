import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { LocalObjectStore, MAX_FILE_BYTES, S3ObjectStore } from '../src/files/object-store';
import { validateEnvironment } from '../src/configuration';

const key = 'schools/00000000-0000-4000-8000-000000000001/lessons/00000000-0000-4000-8000-000000000409/files/00000000-0000-4000-8000-000000000999.pdf';
describe('Private binary object stores', () => {
  it('persists bytes across provider instances and prevents overwrite and traversal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wasl-object-test-'));
    try {
      const store = new LocalObjectStore(dir); await store.ready();
      const bytes = Buffer.from('immutable object'); await store.put(key, bytes);
      const reopened = new LocalObjectStore(dir); expect(await reopened.get(key)).toEqual(bytes);
      await expect(store.put(key, Buffer.from('replacement'))).rejects.toThrow();
      expect(await store.get(key)).toEqual(bytes);
      await expect(store.get('../outside')).rejects.toThrow();
      await store.remove(key); await expect(store.get(key)).rejects.toThrow('File not found');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('uses private bucket commands, conditional writes and streamed binary reads for S3/MinIO', async () => {
    const send = jest.fn().mockResolvedValue({}); const client = { send, destroy: jest.fn() } as unknown as S3Client;
    const store = new S3ObjectStore(client, 'wasl-private');
    await store.ready(); expect(send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
    const bytes = Buffer.from('binary object'); await store.put(key, bytes, 'application/pdf');
    expect(send.mock.calls[1][0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[1][0].input).toMatchObject({ Bucket: 'wasl-private', Key: key, Body: bytes, IfNoneMatch: '*' });
    expect(send.mock.calls[1][0].input.ACL).toBeUndefined();
    send.mockResolvedValueOnce({ Body: Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]) });
    expect(await store.get(key)).toEqual(bytes); expect(send.mock.calls[2][0]).toBeInstanceOf(GetObjectCommand);
    await store.remove(key); expect(send.mock.calls[3][0]).toBeInstanceOf(DeleteObjectCommand);
    store.onModuleDestroy(); expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('maps missing S3 objects and provider failures without using local or fictional bytes', async () => {
    const send = jest.fn(); const store = new S3ObjectStore({ send } as unknown as S3Client, 'wasl-private');
    send.mockRejectedValueOnce(Object.assign(new Error(), { name: 'NoSuchKey' }));
    await expect(store.get(key)).rejects.toThrow('File not found');
    send.mockRejectedValueOnce(new Error('Credentials unavailable'));
    await expect(store.put(key, Buffer.from('x'), 'text/plain')).rejects.toThrow('Could not store file');
    send.mockResolvedValueOnce({ Body: Readable.from([Buffer.alloc(MAX_FILE_BYTES + 1)]) });
    await expect(store.get(key)).rejects.toThrow('File storage is unavailable');
  });

  it('validates S3 configuration and refuses development local storage in production', () => {
    const base = { NODE_ENV: 'production', WASL_STORAGE_DRIVER: 'prisma', JWT_ACCESS_SECRET: 'access-' + 'a'.repeat(40), JWT_REFRESH_SECRET: 'refresh-' + 'b'.repeat(40), DATABASE_URL: 'postgresql://wasl_tenant:p@example.test/wasl', AUTH_DATABASE_URL: 'postgresql://wasl_auth:p@example.test/wasl', PLATFORM_DATABASE_URL: 'postgresql://wasl_platform:p@example.test/wasl', CORS_ORIGINS: 'https://school.example.test' };
    Object.assign(base, { WASL_SUBJECT_PROOF_KEY: randomBytes(32).toString('hex'), ACADEMIC_ADMIN_DATABASE_URL: 'postgresql://wasl_academic_admin:p@example.test/wasl', ASSESSMENT_STAFF_DATABASE_URL: 'postgresql://wasl_assessment_staff:p@example.test/wasl' });
    expect(() => validateEnvironment({ ...base, WASL_FILE_STORAGE_DRIVER: 'local' })).toThrow('private S3');
    expect(() => validateEnvironment(base)).toThrow('S3_BUCKET');
    const configured = { ...base, S3_BUCKET: 'wasl-private', S3_ACCESS_KEY_ID: 'test-key', S3_SECRET_ACCESS_KEY: 'test-secret', S3_ENDPOINT: 'https://objects.example.test' };
    expect(validateEnvironment(configured).WASL_FILE_STORAGE_DRIVER).toBe('s3');
    expect(() => validateEnvironment({ ...configured, S3_ENDPOINT: 'http://objects.example.test' })).toThrow('HTTPS');
    expect(() => validateEnvironment({ ...configured, S3_ENDPOINT: 'https://user:password@objects.example.test' })).toThrow('valid endpoint');
    expect(() => validateEnvironment({ ...configured, S3_FORCE_PATH_STYLE: 'maybe' })).toThrow('true or false');
  });
});
