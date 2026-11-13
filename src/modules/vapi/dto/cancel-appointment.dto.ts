import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class CancelAppointmentDto {
    @IsString()
    @Length(64, 64)
    cancellationToken: string;

    @IsBoolean()
    patientConfirmed: boolean;

    @IsOptional()
    @IsString()
    @Length(1, 300)
    cancellationReason?: string;
}