
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
import { DoctorSchedulesService } from './doctor-schedules.service.js';
import { CreateDoctorScheduleDto } from './dto/create-doctor-schedule.dto.js';
import { QueryDoctorScheduleDto } from './dto/query-doctor-schedule.dto.js';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto.js';


@Controller('doctor-schedules')
@UseGuards(AccessTokenGuard, RolesGuard)
export class DoctorSchedulesController {
    constructor(
        private readonly schedulesService: DoctorSchedulesService,
    ) { }

    @Post()
    @Roles(UserRole.ADMIN)
    create(@Body() dto: CreateDoctorScheduleDto) {
        return this.schedulesService.create(dto);
    }

    @Get()
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    findAll(@Query() query: QueryDoctorScheduleDto) {
        return this.schedulesService.findAll(query);
    }

    @Get('doctor/:doctorId')
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    findByDoctor(@Param('doctorId') doctorId: string) {
        return this.schedulesService.findByDoctor(doctorId);
    }

    @Get(':id')
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    findOne(@Param('id') id: string) {
        return this.schedulesService.findOne(id);
    }

    @Patch(':id')
    @Roles(UserRole.ADMIN)
    update(
        @Param('id') id: string,
        @Body() dto: UpdateDoctorScheduleDto,
    ) {
        return this.schedulesService.update(id, dto);
    }

    @Patch(':id/deactivate')
    @Roles(UserRole.ADMIN)
    deactivate(@Param('id') id: string) {
        return this.schedulesService.deactivate(id);
    }
}
