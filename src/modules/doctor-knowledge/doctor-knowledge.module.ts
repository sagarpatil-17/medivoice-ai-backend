import { Module } from '@nestjs/common';
import { DoctorKnowledgeService } from './doctor-knowledge.service.js';
import { EmbeddingService } from './services/embedding.service.js';
import { DoctorKnowledgeController } from './doctor-knowledge.controller.js';


@Module({
    controllers: [DoctorKnowledgeController],
    providers: [DoctorKnowledgeService, EmbeddingService]
})
export class DoctorKnowledgeModule { }
