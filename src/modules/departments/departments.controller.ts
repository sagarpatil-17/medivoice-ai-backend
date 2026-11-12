
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
import { DepartmentsService } from './departments.service.js';
import { CreateDepartmentDto } from './dto/create-department.dto.js';
import { QueryDepartmentDto } from './dto/query-department.dto.js';
import { UpdateDepartmentDto } from './dto/update-department.dto.js';



@Controller('departments')
@UseGuards(AccessTokenGuard, RolesGuard)
export class DepartmentsController {
    constructor(
        private readonly departmentsService: DepartmentsService,
    ) { }

    @Post()
    @Roles(UserRole.ADMIN)
    create(@Body() dto: CreateDepartmentDto) {
        return this.departmentsService.create(dto);
    }

    @Get()
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    findAll(@Query() query: QueryDepartmentDto) {
        return this.departmentsService.findAll(query);
    }

    @Get(':id')
    @Roles(
        UserRole.ADMIN,
        UserRole.RECEPTIONIST,
        UserRole.DOCTOR,
    )
    findOne(@Param('id') id: string) {
        return this.departmentsService.findOne(id);
    }

    @Patch(':id')
    @Roles(UserRole.ADMIN)
    update(
        @Param('id') id: string,
        @Body() dto: UpdateDepartmentDto,
    ) {
        return this.departmentsService.update(id, dto);
    }

    @Patch(':id/deactivate')
    @Roles(UserRole.ADMIN)
    deactivate(@Param('id') id: string) {
        return this.departmentsService.deactivate(id);
    }
}
