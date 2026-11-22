import { AnnouncementsController, NotificationsController } from './communication.controllers';
import { CommunicationService } from './communication.service';
import { AssessmentsController, SubmissionsController, ResultsController } from './assessment.controllers';
import { AssessmentService } from './assessment.service';
import { Module } from '@nestjs/common';
import { foundationControllers } from './controllers';
import { FoundationService } from './foundation.service';
import { LessonsController, UnitsController } from './content.controllers';
import { ContentService } from './content.service';
import { QuestionBanksController, QuestionsController, ResourcesController, StudentQuestionsController } from './learning.controllers';
import { LearningService } from './learning.service';
@Module({ controllers: [...foundationControllers, UnitsController, LessonsController, ResourcesController, QuestionBanksController, QuestionsController, StudentQuestionsController, AssessmentsController, SubmissionsController, ResultsController, AnnouncementsController, NotificationsController], providers: [FoundationService, ContentService, LearningService, AssessmentService, CommunicationService] })
export class FoundationModule {}
