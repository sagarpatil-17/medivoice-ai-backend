
import { Transform, Type } from 'class-transformer';
import {
    IsBoolean,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    Max,
    Min,
} from 'class-validator';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateDoctorScheduleDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^[a-fA-F0-9]{24}$/, {
        message: 'Invalid doctor ID.',
    })
    doctorId!: string;

    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(6)
    dayOfWeek!: number;

    @IsString()
    @Matches(TIME_REGEX, {
        message: 'startTime must use HH:mm format.',
    })
    startTime!: string;

    @IsString()
    @Matches(TIME_REGEX, {
        message: 'endTime must use HH:mm format.',
    })
    endTime!: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(5)
    @Max(240)
    slotDurationMinutes = 30;

    @IsOptional()
    @IsString()
    @Matches(TIME_REGEX)
    breakStartTime?: string;

    @IsOptional()
    @IsString()
    @Matches(TIME_REGEX)
    breakEndTime?: string;

    @IsOptional()
    @Transform(({ value }) => {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return value;
    })
    @IsBoolean()
    isActive = true;
}
