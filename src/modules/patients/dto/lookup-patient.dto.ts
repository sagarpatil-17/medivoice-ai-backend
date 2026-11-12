
import { IsString, Matches } from 'class-validator';

export class LookupPatientDto {
    @IsString()
    @Matches(/^\+[1-9]\d{7,14}$/, {
        message: 'Phone must be in E.164 format.',
    })
    phone!: string;
}
