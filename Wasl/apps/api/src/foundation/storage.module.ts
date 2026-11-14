import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE } from './repositories';
import { MemoryStorage } from './memory.adapter';
import { developmentState } from './memory.seed';

@Global()
@Module({ providers: [{ provide: STORAGE, inject: [ConfigService], useFactory: async (config: ConfigService) => {
  const driver = config.getOrThrow<string>('WASL_STORAGE_DRIVER');
  if (driver === 'memory') {
    if (config.get('NODE_ENV') === 'production') throw new Error('Memory storage is forbidden in production');
    return new MemoryStorage(await developmentState(config.getOrThrow<string>('WASL_DEV_PASSWORD')));
  }
  if (driver !== 'prisma') throw new Error('Unsupported storage driver');
  const { PrismaStorage } = await import('./prisma.adapter');
  return PrismaStorage.open(config.getOrThrow<string>('DATABASE_URL'));
} }], exports: [STORAGE] })
export class StorageModule {}
