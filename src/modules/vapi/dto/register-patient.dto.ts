
import { Transform } from 'class-transformer';
import {
    IsEmail,
    IsOptional,
    IsString,
    Length,
    Matches,
} from 'class-validator';

export class RegisterPatientDto {
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @Length(1, 80)
    firstName: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @Length(1, 80)
    lastName: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @Matches(/^\+[1-9]\d{7,14}$/, {
        message: 'Phone number must use E.164 format, e.g. +919876543210.',
    })
    phone: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim().toLowerCase() : value,
    )
    @IsOptional()
    @IsEmail()
    email?: string;
}
