
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
import { DoctorsService } from './doctors.service.js';
import { CreateDoctorDto } from './dto/create-doctor.dto.js';
import { QueryDoctorDto } from './dto/query-doctor.dto.js';
import { UpdateDoctorDto } from './dto/update-doctor.dto.js';


@Controller('doctors')
@UseGuards(AccessTokenGuard, RolesGuard)
export class DoctorsController {
    constructor(
        private readonly doctorsService: DoctorsService,
    ) { }

    @Post()
    @Roles(UserRole.ADMIN)
    create(@Body() dto: CreateDoctorDto) {
        return this.doctorsService.create(dto);
    }

    @Get()
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    findAll(@Query() query: QueryDoctorDto) {
        return this.doctorsService.findAll(query);
    }

    @Get(':id')
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    findOne(@Param('id') id: string) {
        return this.doctorsService.findOne(id);
    }

    @Patch(':id')
    @Roles(UserRole.ADMIN)
    update(
        @Param('id') id: string,
        @Body() dto: UpdateDoctorDto,
    ) {
        return this.doctorsService.update(id, dto);
    }

    @Patch(':id/deactivate')
    @Roles(UserRole.ADMIN)
    deactivate(@Param('id') id: string) {
        return this.doctorsService.deactivate(id);
    }
}
