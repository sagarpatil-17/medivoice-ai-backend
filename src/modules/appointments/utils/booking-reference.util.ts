import { randomBytes } from 'node:crypto';

export function generateBookingReference(): string {
    return `MED-${randomBytes(5).toString('hex').toUpperCase()}`;
}