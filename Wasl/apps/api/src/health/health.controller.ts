import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { STORAGE } from '../foundation/repositories';
import type { FoundationStorage } from '../foundation/repositories';
@ApiTags('health') @Controller('health')
export class HealthController {
  constructor(@Inject(STORAGE) private storage: FoundationStorage) {}
  @Public() @Get() @ApiOkResponse({ schema: { example: { status: 'ok', storageDriver: 'memory' } } })
  health() { return { status: 'ok', storageDriver: this.storage.driver }; }
  @Public() @Get('ready') @ApiOkResponse({ schema: { example: { status: 'ok', storageDriver: 'memory' } } })
  async ready() {
    try { await this.storage.ready(); return { status: 'ok', storageDriver: this.storage.driver }; }
    catch { throw new ServiceUnavailableException('Storage is not ready'); }
  }
}
