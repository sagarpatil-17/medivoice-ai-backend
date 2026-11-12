import { Module } from '@nestjs/common';
import { VapiController } from './vapi.controller.js';
import { VapiService } from './vapi.service.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { VapiAuthGuard } from './guards/vapi-auth.guard.js';

@Module({
  imports: [AppointmentsModule],
  controllers: [VapiController],
  providers: [VapiService, VapiAuthGuard]
})
export class VapiModule { }
