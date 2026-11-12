
import { Transform } from 'class-transformer';
import {
    IsDateString,
    IsEmail,
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
} from 'class-validator';
import { Gender } from '@prisma/client';

export class CreatePatientDto {
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @IsNotEmpty()
    @MaxLength(60)
    firstName!: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @IsNotEmpty()
    @MaxLength(60)
    lastName!: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @Matches(/^\+[1-9]\d{7,14}$/, {
        message: 'Phone must be in E.164 format, e.g. +919876543210.',
    })
    phone!: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim().toLowerCase() : value,
    )
    @IsOptional()
    @IsEmail()
    @MaxLength(254)
    email?: string;

    @IsOptional()
    @IsDateString()
    dateOfBirth?: string;

    @IsOptional()
    @IsEnum(Gender)
    gender?: Gender;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @MaxLength(300)
    address?: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    notes?: string;
}
