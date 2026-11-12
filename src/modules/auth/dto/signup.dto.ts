import {
    IsEmail,
    IsEnum,
    IsNotEmpty,
    IsString,
    MaxLength,
    MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export class SignupDto {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    name: string;

    @ApiProperty()
    @IsEmail()
    @MaxLength(254)
    email: string;

    @ApiProperty()
    @IsString()
    @MinLength(4)
    @MaxLength(72)
    password: string;

    @ApiProperty()
    @IsEnum(UserRole)
    role: UserRole;
}