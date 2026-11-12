
import { IsString, Matches } from 'class-validator';

export class CheckAvailabilityDto {
    @IsString()
    @Matches(/^[a-fA-F0-9]{24}$/, {
        message: 'Invalid doctor ID.',
    })
    doctorId!: string;

    @IsString()
    @Matches(/^\d{4}-\d{2}-\d{2}$/, {
        message: 'Date must use YYYY-MM-DD format.',
    })
    date!: string;
}
