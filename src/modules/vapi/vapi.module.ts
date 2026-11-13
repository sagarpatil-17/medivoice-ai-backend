import { Module } from '@nestjs/common';
import { VapiController } from './vapi.controller.js';
import { VapiService } from './vapi.service.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { VapiAuthGuard } from './guards/vapi-auth.guard.js';
import { DoctorKnowledgeModule } from '../doctor-knowledge/doctor-knowledge.module.js';
import { PatientsModule } from '../patients/patients.module.js';

@Module({
  imports: [AppointmentsModule, DoctorKnowledgeModule, PatientsModule],
  controllers: [VapiController],
  providers: [VapiService, VapiAuthGuard]
})
export class VapiModule { }
