
import { Type } from 'class-transformer';
import {
    IsIn,
    IsOptional,
    IsInt,
} from 'class-validator';

export class DashboardTrendsDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @IsIn([7, 30])
    days?: number = 7;
}
