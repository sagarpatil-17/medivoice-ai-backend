
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
import { AppointmentStatus, UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { AppointmentsService } from './appointments.service.js';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto.js';
import { CheckAvailabilityDto } from './dto/check-availability.dto.js';
import { CreateAppointmentDto } from './dto/create-appointment.dto.js';
import { QueryAppointmentDto } from './dto/query-appointment.dto.js';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto.js';


type AuthenticatedActor = {
    id: string;
    role: UserRole;
};

@Controller('appointments')
@UseGuards(AccessTokenGuard, RolesGuard)
export class AppointmentsController {
    constructor(
        private readonly appointmentsService: AppointmentsService,
    ) { }

    @Post('availability')
    @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
    checkAvailability(@Body() dto: CheckAvailabilityDto) {
        return this.appointmentsService.checkAvailability(dto);
    }

    @Post()
    @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
    create(
        @Body() dto: CreateAppointmentDto,
        @CurrentUser() actor: AuthenticatedActor,
    ) {
        return this.appointmentsService.create(dto, actor);
    }

    @Get()
    @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
    findAll(@Query() query: QueryAppointmentDto) {
        return this.appointmentsService.findAll(query);
    }

    @Get(':id')
    @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
    findOne(@Param('id') id: string) {
        return this.appointmentsService.findOne(id);
    }

    @Patch(':id/reschedule')
    @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
    reschedule(
        @Param('id') id: string,
        @Body() dto: RescheduleAppointmentDto,
    ) {
        return this.appointmentsService.reschedule(id, dto);
    }

    @Patch(':id/cancel')
    @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
    cancel(
        @Param('id') id: string,
        @Body() dto: CancelAppointmentDto,
    ) {
        return this.appointmentsService.cancel(id, dto);
    }

    @Patch(':id/complete')
    @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
    complete(@Param('id') id: string) {
        return this.appointmentsService.updateStatus(
            id,
            AppointmentStatus.COMPLETED,
        );
    }

    @Patch(':id/no-show')
    @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
    markNoShow(@Param('id') id: string) {
        return this.appointmentsService.updateStatus(
            id,
            AppointmentStatus.NO_SHOW,
        );
    }
}
