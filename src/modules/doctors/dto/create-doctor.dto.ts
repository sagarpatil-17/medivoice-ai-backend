
import { Transform, Type } from 'class-transformer';
import {
    IsEmail,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

export class CreateDoctorDto {
    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    fullName!: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim().toLowerCase() : value,
    )
    @IsEmail()
    @MaxLength(254)
    email!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(72)
    password!: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @MaxLength(20)
    phone?: string;

    @IsString()
    @IsNotEmpty()
    @Matches(/^[a-fA-F0-9]{24}$/, {
        message: 'Invalid department ID.',
    })
    departmentId!: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    specialization!: string;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @IsNotEmpty()
    @MaxLength(150)
    qualification!: string;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(60)
    experienceYears!: number;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(100000000)
    consultationFee!: number;

    @Transform(({ value }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    bio?: string;
}
