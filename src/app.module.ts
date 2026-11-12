import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DepartmentsModule } from './modules/departments/departments.module.js';
import { DoctorsModule } from './modules/doctors/doctors.module.js';
import { DoctorSchedulesModule } from './modules/doctor-schedules/doctor-schedules.module.js';
import { PatientsModule } from './modules/patients/patients.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    DepartmentsModule,
    DoctorsModule,
    DoctorSchedulesModule,
    PatientsModule,
    ConfigModule.forRoot({
      isGlobal: true
    }),
  ],
  controllers: []
})
export class AppModule { }
