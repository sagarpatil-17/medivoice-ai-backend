
import {
    Controller,
    Post,
    UseGuards,
} from '@nestjs/common';

import { DoctorKnowledgeService } from './doctor-knowledge.service.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '@prisma/client';

@Controller('doctor-knowledge')
@UseGuards(AccessTokenGuard, RolesGuard)
export class DoctorKnowledgeController {
    constructor(
        private readonly doctorKnowledgeService: DoctorKnowledgeService,
    ) { }

    @Post('index')
    @Roles(UserRole.ADMIN)
    indexSpecialties() {
        return this.doctorKnowledgeService.indexSpecialties();
    }
}
