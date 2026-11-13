
import { Module } from '@nestjs/common';

import { CallsController } from './calls.controller.js';
import { CallsService } from './calls.service.js';
import { DatabaseModule } from '../../database/database.module.js';

@Module({
    imports: [DatabaseModule],
    controllers: [CallsController],
    providers: [CallsService],
    exports: [CallsService],
})
export class CallsModule { }
