import { Module } from '@nestjs/common';
import { foundationControllers } from './controllers';
import { FoundationService } from './foundation.service';
@Module({ controllers: foundationControllers, providers: [FoundationService] })
export class FoundationModule {}
