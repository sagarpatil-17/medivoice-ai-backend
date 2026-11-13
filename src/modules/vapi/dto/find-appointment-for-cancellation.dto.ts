import { Transform } from 'class-transformer';
import {
    IsString,
    Length,
    Matches,
} from 'class-validator';

export class FindAppointmentForCancellationDto {
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim().toUpperCase() : value,
    )
    @IsString()
    @Length(14, 14)
    @Matches(/^MED-[A-F0-9]{10}$/)
    bookingReference: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @Matches(/^\+[1-9]\d{7,14}$/)
    phone: string;
}