
import { Transform } from 'class-transformer';
import {
    IsDateString,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
} from 'class-validator';

export class CreateAppointmentDto {
    @IsString()
    @Matches(/^[a-fA-F0-9]{24}$/)
    patientId!: string;

    @IsString()
    @Matches(/^[a-fA-F0-9]{24}$/)
    doctorId!: string;

    @IsDateString()
    @Matches(/(Z|[+-]\d{2}:\d{2})$/, {
        message: 'startAt must include a timezone, e.g. +05:30.',
    })
    startAt!: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}
