import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants } from 'node:fs';
import { access, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const OBJECT_STORE = Symbol('WASL_OBJECT_STORE');
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export interface ObjectStore {
  readonly driver: 'local' | 's3';
  ready(): Promise<void>;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
function safeKey(key: string) {
  if (!/^schools\/[a-f0-9-]+\/(?:lessons|students)\/[a-f0-9-]+\/files\/[a-f0-9-]+\.[a-z0-9]+$/.test(key)) throw new NotFoundException('File not found');
}
function code(error: unknown): string | undefined { return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined; }
export class LocalObjectStore implements ObjectStore {
  readonly driver = 'local' as const;
  constructor(private root: string) { this.root = resolve(root); }
  private path(key: string) { safeKey(key); const path = resolve(this.root, key); if (!path.startsWith(this.root + sep)) throw new NotFoundException('File not found'); return path; }
  async ready() { await mkdir(this.root, { recursive: true, mode: 0o700 }); await access(this.root, constants.R_OK | constants.W_OK); }
  async put(key: string, data: Buffer) {
    const path = this.path(key);
    try { await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, data, { flag: 'wx', mode: 0o600 }); }
    catch { throw new ServiceUnavailableException('Could not store file'); }
  }
  async get(key: string) {
    try { const path = this.path(key); const info = await stat(path); if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new ServiceUnavailableException('Stored object exceeds the file limit'); return await readFile(path); }
    catch (error) { if (code(error) === 'ENOENT') throw new NotFoundException('File not found'); if (error instanceof NotFoundException) throw error; throw new ServiceUnavailableException('File storage is unavailable'); }
  }
  async remove(key: string) { try { await unlink(this.path(key)); } catch (error) { if (code(error) !== 'ENOENT') throw error; } }
}
export class S3ObjectStore implements ObjectStore {
  readonly driver = 's3' as const;
  constructor(private client: S3Client, private bucket: string) {}
  async ready() { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); }
  async put(key: string, data: Buffer, contentType: string) {
    safeKey(key);
    try { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, ContentLength: data.length, IfNoneMatch: '*' })); }
    catch { throw new ServiceUnavailableException('Could not store file'); }
  }
  async get(key: string) {
    safeKey(key);
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!(result.Body instanceof Readable)) throw new Error('Missing object body');
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of result.Body) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_FILE_BYTES) { result.Body.destroy(); throw new Error('Object exceeds size limit'); }
        chunks.push(bytes);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && ['NoSuchKey', 'NotFound'].includes(String(error.name))) throw new NotFoundException('File not found');
      throw new ServiceUnavailableException('File storage is unavailable');
    }
  }
  async remove(key: string) { safeKey(key); await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
  onModuleDestroy() { this.client.destroy(); }
}
export async function openObjectStore(config: ConfigService): Promise<ObjectStore> {
  const driver = config.get<string>('WASL_FILE_STORAGE_DRIVER') ?? 'local';
  const store = driver === 'local' ? new LocalObjectStore(config.get<string>('WASL_FILES_DIR') ?? resolve(process.cwd(), '.wasl-data', 'files')) : new S3ObjectStore(new S3Client({
    region: config.get<string>('S3_REGION') ?? 'us-east-1',
    endpoint: config.get<string>('S3_ENDPOINT') || undefined,
    forcePathStyle: config.get<string>('S3_FORCE_PATH_STYLE') === 'true',
    credentials: { accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY_ID'), secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY') },
  }), config.getOrThrow<string>('S3_BUCKET'));
  // An S3 outage must not silently select local storage or create a public bucket.
  await store.ready(); return store;
}
