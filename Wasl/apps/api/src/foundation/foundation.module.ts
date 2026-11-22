import { Module } from '@nestjs/common';
import { foundationControllers } from './controllers';
import { FoundationService } from './foundation.service';
import { LessonsController, UnitsController } from './content.controllers';
import { ContentService } from './content.service';
import { QuestionBanksController, QuestionsController, ResourcesController, StudentQuestionsController } from './learning.controllers';
import { LearningService } from './learning.service';
@Module({ controllers: [...foundationControllers, UnitsController, LessonsController, ResourcesController, QuestionBanksController, QuestionsController, StudentQuestionsController], providers: [FoundationService, ContentService, LearningService] })
export class FoundationModule {}
