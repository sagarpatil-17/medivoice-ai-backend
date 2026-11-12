
import { IsDateString, IsString, Matches } from 'class-validator';

export class VerifyPatientDto {
    @IsString()
    @Matches(/^\+[1-9]\d{7,14}$/, {
        message: 'Phone must be in E.164 format.',
    })
    phone!: string;

    @IsDateString()
    dateOfBirth!: string;
}
