
import { Transform } from 'class-transformer';
import {
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
} from 'class-validator';

export class UpdateDepartmentDto {
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name?: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim().toUpperCase() : value,
    )
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(20)
    @Matches(/^[A-Z0-9_-]+$/)
    code?: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;
}
