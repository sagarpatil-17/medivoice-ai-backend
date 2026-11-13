
import {
    Body,
    Controller,
    Get,
    Post,
    UseGuards,
} from '@nestjs/common';

import { DoctorKnowledgeService } from './doctor-knowledge.service.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '@prisma/client';
import { IsString, MinLength, MaxLength } from 'class-validator';

class DoctorSemanticSearchDto {
    @IsString()
    @MinLength(1)
    @MaxLength(300)
    query!: string;
}

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

    @Post('search')
    @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
    search(@Body() dto: DoctorSemanticSearchDto) {
        return this.doctorKnowledgeService.findDoctorsByQuery(
            dto.query,
        );
    }

}
