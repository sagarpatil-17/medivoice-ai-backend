
import { Transform } from 'class-transformer';
import {
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
} from 'class-validator';

export class CreateDepartmentDto {
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name!: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim().toUpperCase() : value,
    )
    @IsString()
    @IsNotEmpty()
    @MaxLength(20)
    @Matches(/^[A-Z0-9_-]+$/, {
        message: 'Code can contain only uppercase letters, numbers, _ and -',
    })
    code!: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;
}
