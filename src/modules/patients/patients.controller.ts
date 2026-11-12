import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { LookupPatientDto } from './dto/lookup-patient.dto.js';
import { QueryPatientDto } from './dto/query-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { VerifyPatientDto } from './dto/verify-patient.dto.js';
import { PatientsService } from './patients.service.js';


@Controller('patients')
@UseGuards(AccessTokenGuard, RolesGuard)
export class PatientsController {
    constructor(
        private readonly patientsService: PatientsService,
    ) { }

    @Post()
    @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
    create(@Body() dto: CreatePatientDto) {
        return this.patientsService.create(dto);
    }

    @Get()
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    findAll(@Query() query: QueryPatientDto) {
        return this.patientsService.findAll(query);
    }

    @Get('lookup')
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    lookupByPhone(@Query() query: LookupPatientDto) {
        return this.patientsService.lookupByPhone(query);
    }

    @Post('verify')
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    verify(@Body() dto: VerifyPatientDto) {
        return this.patientsService.verify(dto);
    }

    @Get(':id/appointments')
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    getAppointmentHistory(@Param('id') id: string) {
        return this.patientsService.getAppointmentHistory(id);
    }

    @Get(':id')
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    findOne(@Param('id') id: string) {
        return this.patientsService.findOne(id);
    }

    @Patch(':id')
    @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
    update(
        @Param('id') id: string,
        @Body() dto: UpdatePatientDto,
    ) {
        return this.patientsService.update(id, dto);
    }
}
