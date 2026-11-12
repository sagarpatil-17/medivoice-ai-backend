
import { Transform, Type } from 'class-transformer';
import {
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

export class UpdateDoctorDto {
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    fullName?: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @MaxLength(20)
    phone?: string;

    @IsOptional()
    @IsString()
    @Matches(/^[a-fA-F0-9]{24}$/)
    departmentId?: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    specialization?: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(150)
    qualification?: string;

    @Type(() => Number)
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(60)
    experienceYears?: number;

    @Type(() => Number)
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(100000000)
    consultationFee?: number;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    bio?: string;
}
