import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DepartmentsModule } from './modules/departments/departments.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    DepartmentsModule,
    ConfigModule.forRoot({
      isGlobal: true
    }),
  ],
  controllers: []
})
export class AppModule { }
