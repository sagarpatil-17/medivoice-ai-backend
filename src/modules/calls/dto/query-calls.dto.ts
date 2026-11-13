
import {
    IsEnum,
    IsInt,
    IsISO8601,
    IsOptional,
    IsString,
    Max,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import { CallOutcome, CallStatus } from '@prisma/client';

export class QueryCallsDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 10;

    @IsOptional()
    @IsEnum(CallStatus)
    status?: CallStatus;

    @IsOptional()
    @IsEnum(CallOutcome)
    outcome?: CallOutcome;

    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsISO8601({ strict: true })
    from?: string;

    @IsOptional()
    @IsISO8601({ strict: true })
    to?: string;
}
