
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { CreateDoctorScheduleDto } from './dto/create-doctor-schedule.dto.js';
import { QueryDoctorScheduleDto } from './dto/query-doctor-schedule.dto.js';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto.js';


@Injectable()
export class DoctorSchedulesService {
    constructor(private readonly prisma: PrismaService) { }

    private validateId(id: string): void {
        if (!/^[a-fA-F0-9]{24}$/.test(id)) {
            throw new BadRequestException('Invalid ID.');
        }
    }

    private toMinutes(time: string): number {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    }

    private validateTimes(data: {
        startTime: string;
        endTime: string;
        breakStartTime?: string | null;
        breakEndTime?: string | null;
    }): void {
        const start = this.toMinutes(data.startTime);
        const end = this.toMinutes(data.endTime);

        if (end <= start) {
            throw new BadRequestException(
                'End time must be later than start time.',
            );
        }

        const hasBreakStart = !!data.breakStartTime;
        const hasBreakEnd = !!data.breakEndTime;

        if (hasBreakStart !== hasBreakEnd) {
            throw new BadRequestException(
                'Both break start and break end times must be provided.',
            );
        }

        if (hasBreakStart && hasBreakEnd) {
            const breakStart = this.toMinutes(data.breakStartTime!);
            const breakEnd = this.toMinutes(data.breakEndTime!);

            if (
                breakStart <= start ||
                breakEnd >= end ||
                breakEnd <= breakStart
            ) {
                throw new BadRequestException(
                    'Break must be within the shift and have a valid duration.',
                );
            }
        }
    }

    private async validateDoctor(doctorId: string): Promise<void> {
        this.validateId(doctorId);

        const doctor = await this.prisma.doctor.findFirst({
            where: {
                id: doctorId,
                isActive: true,
            },
            select: { id: true },
        });

        if (!doctor) {
            throw new NotFoundException('Active doctor not found.');
        }
    }

    private async validateNoOverlap(params: {
        doctorId: string;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        excludeId?: string;
    }): Promise<void> {
        const schedules = await this.prisma.doctorSchedule.findMany({
            where: {
                doctorId: params.doctorId,
                dayOfWeek: params.dayOfWeek,
                isActive: true,
                ...(params.excludeId && {
                    id: { not: params.excludeId },
                }),
            },
            select: {
                id: true,
                startTime: true,
                endTime: true,
            },
        });

        const newStart = this.toMinutes(params.startTime);
        const newEnd = this.toMinutes(params.endTime);

        const overlaps = schedules.some((schedule) => {
            const existingStart = this.toMinutes(schedule.startTime);
            const existingEnd = this.toMinutes(schedule.endTime);

            // Adjacent shifts are allowed: 09:00-13:00 and 13:00-17:00.
            return newStart < existingEnd && newEnd > existingStart;
        });

        if (overlaps) {
            throw new ConflictException(
                'This shift overlaps with another active schedule for the doctor.',
            );
        }
    }

    // CREATE SCHEDULE
    async create(dto: CreateDoctorScheduleDto) {
        await this.validateDoctor(dto.doctorId);

        this.validateTimes(dto);

        if (dto.isActive !== false) {
            await this.validateNoOverlap({
                doctorId: dto.doctorId,
                dayOfWeek: dto.dayOfWeek,
                startTime: dto.startTime,
                endTime: dto.endTime,
            });
        }

        return this.prisma.doctorSchedule.create({
            data: {
                doctorId: dto.doctorId,
                dayOfWeek: dto.dayOfWeek,
                startTime: dto.startTime,
                endTime: dto.endTime,
                slotDurationMinutes: dto.slotDurationMinutes ?? 30,
                breakStartTime: dto.breakStartTime,
                breakEndTime: dto.breakEndTime,
                isActive: dto.isActive ?? true,
            },
            include: {
                doctor: {
                    select: {
                        id: true,
                        fullName: true,
                        specialization: true,
                    },
                },
            },
        });
    }

    // LIST SCHEDULES
    async findAll(query: QueryDoctorScheduleDto) {
        const where: Prisma.DoctorScheduleWhereInput = {
            ...(query.doctorId && {
                doctorId: query.doctorId,
            }),
            ...(query.dayOfWeek !== undefined && {
                dayOfWeek: query.dayOfWeek,
            }),
            ...(query.isActive !== undefined && {
                isActive: query.isActive,
            }),
        };

        return this.prisma.doctorSchedule.findMany({
            where,
            orderBy: [
                { doctorId: 'asc' },
                { dayOfWeek: 'asc' },
                { startTime: 'asc' },
            ],
            include: {
                doctor: {
                    select: {
                        id: true,
                        fullName: true,
                        specialization: true,
                        isActive: true,
                    },
                },
            },
        });
    }

    // GET ONE SCHEDULE
    async findOne(id: string) {
        this.validateId(id);

        const schedule = await this.prisma.doctorSchedule.findUnique({
            where: { id },
            include: {
                doctor: {
                    select: {
                        id: true,
                        fullName: true,
                        specialization: true,
                        isActive: true,
                    },
                },
            },
        });

        if (!schedule) {
            throw new NotFoundException('Doctor schedule not found.');
        }

        return schedule;
    }

    // GET ALL SCHEDULES FOR A DOCTOR
    async findByDoctor(doctorId: string) {
        await this.validateDoctor(doctorId);

        return this.prisma.doctorSchedule.findMany({
            where: {
                doctorId,
                isActive: true,
            },
            orderBy: [
                { dayOfWeek: 'asc' },
                { startTime: 'asc' },
            ],
        });
    }

    // UPDATE SCHEDULE
    async update(id: string, dto: UpdateDoctorScheduleDto) {
        const existing = await this.findOne(id);

        const doctorId = dto.doctorId ?? existing.doctorId;
        const dayOfWeek = dto.dayOfWeek ?? existing.dayOfWeek;
        const startTime = dto.startTime ?? existing.startTime;
        const endTime = dto.endTime ?? existing.endTime;
        const breakStartTime =
            dto.breakStartTime !== undefined
                ? dto.breakStartTime
                : existing.breakStartTime;
        const breakEndTime =
            dto.breakEndTime !== undefined
                ? dto.breakEndTime
                : existing.breakEndTime;
        const isActive = dto.isActive ?? existing.isActive;

        await this.validateDoctor(doctorId);

        this.validateTimes({
            startTime,
            endTime,
            breakStartTime,
            breakEndTime,
        });

        if (isActive) {
            await this.validateNoOverlap({
                doctorId,
                dayOfWeek,
                startTime,
                endTime,
                excludeId: id,
            });
        }

        return this.prisma.doctorSchedule.update({
            where: { id },
            data: {
                doctorId,
                dayOfWeek,
                startTime,
                endTime,
                breakStartTime,
                breakEndTime,
                isActive,
                ...(dto.slotDurationMinutes !== undefined && {
                    slotDurationMinutes: dto.slotDurationMinutes,
                }),
            },
            include: {
                doctor: {
                    select: {
                        id: true,
                        fullName: true,
                        specialization: true,
                    },
                },
            },
        });
    }

    // DEACTIVATE SCHEDULE
    async deactivate(id: string) {
        const schedule = await this.findOne(id);

        if (!schedule.isActive) {
            throw new ConflictException(
                'Schedule is already inactive.',
            );
        }

        return this.prisma.doctorSchedule.update({
            where: { id },
            data: { isActive: false },
        });
    }
}
