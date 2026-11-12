
import {
    Controller,
    Get,
    Query,
    UseGuards,
    ParseIntPipe,
    DefaultValuePipe,
} from '@nestjs/common';

import { UserRole } from '@prisma/client';

import { DashboardService } from './dashboard.service.js';
import { DashboardTrendsDto } from './dto/dashboard-trends.dto.js';

import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';

@Controller('dashboard')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
export class DashboardController {
    constructor(
        private readonly dashboardService: DashboardService,
    ) { }

    // GET /api/dashboard/overview
    @Get('overview')
    getOverview() {
        return this.dashboardService.getOverview();
    }

    // GET /api/dashboard/appointment-trends?days=7
    // GET /api/dashboard/appointment-trends?days=30
    @Get('appointment-trends')
    getAppointmentTrends(
        @Query() dto: DashboardTrendsDto,
    ) {
        return this.dashboardService.getAppointmentTrends(
            dto,
        );
    }

    // GET /api/dashboard/appointment-status
    @Get('appointment-status')
    getAppointmentStatus() {
        return this.dashboardService.getAppointmentStatus();
    }

    // GET /api/dashboard/recent-appointments?limit=10
    @Get('recent-appointments')
    getRecentAppointments(
        @Query(
            'limit',
            new DefaultValuePipe(10),
            ParseIntPipe,
        )
        limit: number,
    ) {
        return this.dashboardService.getRecentAppointments(
            limit,
        );
    }

    // GET /api/dashboard/department-stats
    @Get('department-stats')
    getDepartmentStats() {
        return this.dashboardService.getDepartmentStats();
    }
}
