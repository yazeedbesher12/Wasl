import { OBJECT_STORE, type ObjectStore } from '../files/object-store';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { STORAGE } from '../foundation/repositories';
import type { FoundationStorage } from '../foundation/repositories';
@ApiTags('health') @Controller('health')
export class HealthController {
  constructor(@Inject(STORAGE) private storage: FoundationStorage, @Inject(OBJECT_STORE) private objects: ObjectStore) {}
  @Public() @Get() @ApiOkResponse({ schema: { example: { status: 'ok', storageDriver: 'memory' } } })
  health() { return { status: 'ok', storageDriver: this.storage.driver }; }
  @Public() @Get('ready') @ApiOkResponse({ schema: { example: { status: 'ok', storageDriver: 'memory' } } })
  async ready() {
    try { await Promise.all([this.storage.ready(), this.objects.ready()]); return { status: 'ok', storageDriver: this.storage.driver }; }
    catch { throw new ServiceUnavailableException('Storage is not ready'); }
  }
}
