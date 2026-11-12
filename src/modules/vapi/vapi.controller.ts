
import {
    Body,
    Controller,
    Post,
    UseGuards,
} from '@nestjs/common';

import { VapiService } from './vapi.service.js';
import { VapiAuthGuard } from './guards/vapi-auth.guard.js';
import type { VapiWebhookBody } from './types/vapi-webhook.type.js';

@Controller('vapi')
@UseGuards(VapiAuthGuard)
export class VapiController {
    constructor(
        private readonly vapiService: VapiService,
    ) { }

    // POST /api/vapi/webhook
    @Post('webhook')
    handleWebhook(
        @Body() body: VapiWebhookBody,
    ) {
        return this.vapiService.handleWebhook(body);
    }
}

