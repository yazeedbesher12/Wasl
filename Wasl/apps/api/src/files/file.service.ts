import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { FileDto, ParentFileContext } from '@wasl/shared';
import type { AuthUser } from '../auth/auth.types';
import type { FileObject } from '../foundation/entities';
import { requireActor } from '../foundation/authorization';
import { withVerifiedChild } from '../foundation/parent-learning.service';
import type { FileUploadDto } from '../foundation/communication.dto';
import { STORAGE } from '../foundation/repositories';
import type { FoundationStorage, Repositories } from '../foundation/repositories';
import { authorizeFile, authorizeUpload } from './file-access';
import { MAX_FILE_BYTES, OBJECT_STORE, type ObjectStore } from './object-store';

const mimeTypes: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const fileDto = (f: FileObject): FileDto => ({ id: f.id, schoolId: f.schoolId, ownerId: f.ownerId, purpose: f.purpose, lessonId: f.lessonId, assessmentId: f.assessmentId, storageKey: f.storageKey, originalName: f.originalName, contentType: f.contentType, size: f.size, createdAt: f.createdAt.toISOString() });
function inspect(file: Express.Multer.File) {
  const name = file.originalname.normalize('NFKC').replace(/[\p{C}/\\]/gu, '_').slice(0, 180);
  const ext = extname(name).toLowerCase(); const mime = mimeTypes[ext]; const data = file.buffer;
  if (!mime || !data?.length || data.length > MAX_FILE_BYTES || file.size !== data.length || file.mimetype !== mime) throw new BadRequestException('Upload a non-empty supported file of at most 10 MiB with its correct MIME type');
  const signature = ext === '.pdf' ? data.subarray(0, 5).toString() === '%PDF-' : ext === '.png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : ['.jpg', '.jpeg'].includes(ext) ? data[0] === 255 && data[1] === 216 && data[2] === 255 : ext === '.txt' ? !data.includes(0) && Buffer.from(data.toString('utf8'), 'utf8').equals(data) : data.subarray(0, 4).equals(Buffer.from([80,75,3,4]));
  if (!signature) throw new BadRequestException('File content does not match its declared format');
  return { name, ext, mime, data };
}
@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  constructor(@Inject(STORAGE) private storage: FoundationStorage, @Inject(OBJECT_STORE) private objects: ObjectStore) {}
  private scope<T>(actor: AuthUser, work: (r: Repositories) => Promise<T>, participant = actor.sub, uploadTarget?: string) {
    if (!actor.schoolId) throw new ForbiddenException('An active school role is required');
    return this.storage.run({ kind: 'school', userId: actor.sub, schoolId: actor.schoolId,
      assessment: { membershipId: actor.membershipId,
        operation: uploadTarget ? 'file-write' : actor.role === 'PARENT' && participant === actor.sub ? 'metadata' : 'read',
        targetId: uploadTarget ?? participant } },
    async r => { await requireActor(r, actor, ['TEACHER', 'SCHOOL_ADMIN', 'STUDENT', 'PARENT']); return work(r); });
  }
  async upload(actor: AuthUser, input: FileUploadDto, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Attach one file in the file field');
    const { name, ext, mime, data } = inspect(file);
    const uploadTarget = input.purpose === 'LESSON_RESOURCE' ? input.lessonId : input.assessmentId;
    await this.scope(actor, r => authorizeUpload(r, actor, input), actor.sub, uploadTarget);
    const id = randomUUID();
    const key = input.purpose === 'LESSON_RESOURCE' ? `schools/${actor.schoolId}/lessons/${input.lessonId}/files/${id}${ext}` : `schools/${actor.schoolId}/students/${actor.sub}/files/${id}${ext}`;
    const row: FileObject = { id, schoolId: actor.schoolId!, ownerId: actor.sub, purpose: input.purpose, lessonId: input.lessonId ?? null, assessmentId: input.assessmentId ?? null, storageKey: key, storageDriver: this.objects.driver, originalName: name, contentType: mime, size: data.length, sha256: createHash('sha256').update(data).digest('hex'), createdAt: new Date() };
    try {
      await this.objects.put(key, data, mime);
      // Recheck current relationships/lifecycle after the external write. Retries of
      // the database transaction never repeat an object-store write.
      return await this.scope(actor, async r => { await authorizeUpload(r, actor, input); return fileDto(await r.files.create(row)); }, actor.sub, uploadTarget);
    } catch (error) {
      try { await this.objects.remove(key); } catch { this.logger.warn('A failed upload left an object for maintenance cleanup'); }
      throw error;
    }
  }
  private async authorizedFile(actor: AuthUser, lookup: (r: Repositories) => Promise<FileObject | null>, child?: ParentFileContext) {
    if (child) {
      try {
        return await withVerifiedChild(this.storage, actor, child.studentId, child.schoolId, async r => {
          const file = await lookup(r);
          if (file?.purpose !== 'LESSON_RESOURCE' || file.schoolId !== child.schoolId)
            throw new NotFoundException('File not found');
          await authorizeFile(r, actor, file, child.studentId);
          return file;
        });
      } catch (error) {
        if (error instanceof NotFoundException) throw new NotFoundException('File not found');
        throw error;
      }
    }
    // Use parent file metadata only to bind the follow-up proof to one child. The
    // authorization transaction looks up the file again and rechecks the link.
    const candidate = actor.role === 'PARENT' ? await this.scope(actor, lookup) : null;
    const participant = candidate?.purpose === 'ASSESSMENT_ANSWER' ? candidate.ownerId : actor.sub;
    return this.scope(actor, async r => {
      const file = await lookup(r);
      if (!file || (actor.role === 'PARENT' && file.purpose === 'ASSESSMENT_ANSWER' && file.ownerId !== participant)) throw new NotFoundException('File not found');
      await authorizeFile(r, actor, file);
      return file;
    }, participant);
  }
  async resolve(actor: AuthUser, key: string, child?: ParentFileContext) {
    return fileDto(await this.authorizedFile(actor, r => r.files.byKey(key), child));
  }
  metadata(actor: AuthUser, id: string, child?: ParentFileContext) {
    return this.authorizedFile(actor, r => r.files.get(id), child).then(fileDto);
  }
  async download(actor: AuthUser, id: string, child?: ParentFileContext) {
    const f = await this.authorizedFile(actor, r => r.files.get(id), child);
    if (f.storageDriver !== this.objects.driver) throw new ServiceUnavailableException('The configured file store does not hold this file');
    const data = await this.objects.get(f.storageKey);
    if (data.length !== f.size || createHash('sha256').update(data).digest('hex') !== f.sha256) throw new ServiceUnavailableException('Stored file integrity check failed');
    // Do not return bytes after a role/link/publication change during retrieval.
    await this.authorizedFile(actor, r => r.files.get(id), child);
    return { data, metadata: fileDto(f) };
  }
}
