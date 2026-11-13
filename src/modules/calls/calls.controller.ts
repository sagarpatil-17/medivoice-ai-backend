
import {
    Controller,
    Get,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';

import { CallsService } from './calls.service.js';
import { QueryCallsDto } from './dto/query-calls.dto.js';

import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '@prisma/client';

@Controller('calls')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
export class CallsController {
    constructor(
        private readonly callsService: CallsService,
    ) { }

    @Get('overview')
    getOverview() {
        return this.callsService.getOverview();
    }

    @Get()
    findAll(
        @Query() query: QueryCallsDto,
    ) {
        return this.callsService.findAll(query);
    }

    @Get(':id')
    findOne(
        @Param('id') id: string,
    ) {
        return this.callsService.findOne(id);
    }
}
