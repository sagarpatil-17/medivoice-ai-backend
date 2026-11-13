import { createHash, randomBytes } from 'node:crypto';

export function generateCancellationToken(): string {
    return randomBytes(32).toString('hex');
}

export function hashCancellationToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}