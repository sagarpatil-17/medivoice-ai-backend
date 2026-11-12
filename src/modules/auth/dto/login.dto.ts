import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
    @ApiProperty()
    @IsEmail()
    @MaxLength(254)
    email: string;

    @ApiProperty()
    @IsString()
    @MinLength(4)
    @MaxLength(72)
    password: string;
}