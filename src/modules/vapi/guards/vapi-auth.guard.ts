
import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';

import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class VapiAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context
            .switchToHttp()
            .getRequest<Request>();

        const expectedSecret =
            process.env.VAPI_WEBHOOK_SECRET;

        if (!expectedSecret) {
            throw new UnauthorizedException(
                'Vapi webhook authentication is not configured.',
            );
        }

        const authorization =
            request.headers.authorization;

        if (!authorization?.startsWith('Bearer ')) {
            throw new UnauthorizedException(
                'Missing webhook authorization.',
            );
        }

        const receivedSecret = authorization.slice(7);

        const expectedBuffer = Buffer.from(expectedSecret);
        const receivedBuffer = Buffer.from(receivedSecret);

        if (
            expectedBuffer.length !== receivedBuffer.length ||
            !timingSafeEqual(
                expectedBuffer,
                receivedBuffer,
            )
        ) {
            throw new UnauthorizedException(
                'Invalid webhook authorization.',
            );
        }

        return true;
    }
}
