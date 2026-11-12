
import { Type } from 'class-transformer';
import {
    IsDateString,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Matches,
    Max,
    Min,
} from 'class-validator';
import { AppointmentStatus } from '@prisma/client';

export class QueryAppointmentDto {
    @IsOptional()
    @IsString()
    @Matches(/^[a-fA-F0-9]{24}$/)
    patientId?: string;

    @IsOptional()
    @IsString()
    @Matches(/^[a-fA-F0-9]{24}$/)
    doctorId?: string;

    @IsOptional()
    @IsEnum(AppointmentStatus)
    status?: AppointmentStatus;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit = 10;
}
