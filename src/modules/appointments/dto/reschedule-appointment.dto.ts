
import { IsDateString, Matches } from 'class-validator';

export class RescheduleAppointmentDto {
    @IsDateString()
    @Matches(/(Z|[+-]\d{2}:\d{2})$/, {
        message: 'startAt must include a timezone offset.',
    })
    startAt!: string;
}
