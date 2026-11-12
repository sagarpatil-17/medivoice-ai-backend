import { Module } from '@nestjs/common';
import { DoctorSchedulesController } from './doctor-schedules.controller.js';
import { DoctorSchedulesService } from './doctor-schedules.service.js';

@Module({
  controllers: [DoctorSchedulesController],
  providers: [DoctorSchedulesService]
})
export class DoctorSchedulesModule {}
