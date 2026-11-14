// Compatibility entry point: StorageModule owns adapter selection.
// No eager import of the Prisma runtime in memory mode.
export { StorageModule as PrismaModule } from '../foundation/storage.module';
