import { Module } from '@nestjs/common';
import { foundationControllers } from './controllers';
import { FoundationService } from './foundation.service';
import { LessonsController, UnitsController } from './content.controllers';
import { ContentService } from './content.service';
@Module({ controllers: [...foundationControllers, UnitsController, LessonsController], providers: [FoundationService, ContentService] })
export class FoundationModule {}
