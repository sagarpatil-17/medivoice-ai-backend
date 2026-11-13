import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import {
    AppointmentStatus,
    BookingSource,
    Prisma,
    UserRole,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service.js';

import { CheckAvailabilityDto } from './dto/check-availability.dto.js';
import { CreateAppointmentDto } from './dto/create-appointment.dto.js';
import { QueryAppointmentDto } from './dto/query-appointment.dto.js';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto.js';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto.js';
import { generateBookingReference } from './utils/booking-reference.util.js';

const HOSPITAL_OFFSET = '+05:30';
const HOSPITAL_TIMEZONE = 'Asia/Kolkata';

const ACTIVE_STATUSES: AppointmentStatus[] = [
    AppointmentStatus.PENDING,
    AppointmentStatus.CONFIRMED,
];

type Actor = {
    id: string;
    role: UserRole;
};

@Injectable()
export class AppointmentsService {
    constructor(private readonly prisma: PrismaService) { }

    // VALIDATION HELPERS

    private validateId(id: string): void {
        if (!/^[a-fA-F0-9]{24}$/.test(id)) {
            throw new BadRequestException('Invalid ID.');
        }
    }

    private parseLocalDate(date: string): Date {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new BadRequestException(
                'Date must use YYYY-MM-DD format.',
            );
        }

        const parsed = new Date(`${date}T00:00:00.000Z`);

        if (
            Number.isNaN(parsed.getTime()) ||
            parsed.toISOString().slice(0, 10) !== date
        ) {
            throw new BadRequestException('Invalid calendar date.');
        }

        return parsed;
    }

    private parseDateTime(value: string): Date {
        // Require an explicit timezone to avoid server-local
        // timezone interpretation.
        const hasTimezone =
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
                value,
            );

        if (!hasTimezone) {
            throw new BadRequestException(
                'Date-time must include an explicit timezone, such as +05:30 or Z.',
            );
        }

        const parsed = new Date(value);

        if (Number.isNaN(parsed.getTime())) {
            throw new BadRequestException('Invalid date-time.');
        }

        return parsed;
    }

    private assertValidStartAt(value: string): Date {
        const date = this.parseDateTime(value);

        if (date.getTime() <= Date.now()) {
            throw new BadRequestException(
                'Appointment must be scheduled in the future.',
            );
        }

        if (
            date.getUTCSeconds() !== 0 ||
            date.getUTCMilliseconds() !== 0
        ) {
            throw new BadRequestException(
                'Appointment start time must be on a whole minute.',
            );
        }

        return date;
    }

    private getHospitalParts(value: Date) {
        // Asia/Kolkata is UTC+05:30 and has no daylight-saving changes.
        const local = new Date(
            value.getTime() + 330 * 60_000,
        );

        return {
            date: local.toISOString().slice(0, 10),
            dayOfWeek: local.getUTCDay(),
            time: `${String(local.getUTCHours()).padStart(2, '0')}:${String(
                local.getUTCMinutes(),
            ).padStart(2, '0')}`,
            seconds: local.getUTCSeconds(),
        };
    }

    private localDateTimeToUtc(
        date: string,
        time: string,
    ): Date {
        return new Date(
            `${date}T${time}:00${HOSPITAL_OFFSET}`,
        );
    }

    private toMinutes(value: string): number {
        const [hours, minutes] = value.split(':').map(Number);

        return hours * 60 + minutes;
    }

    private validateActor(actor: Actor): void {
        if (
            actor.role !== UserRole.ADMIN &&
            actor.role !== UserRole.RECEPTIONIST
        ) {
            throw new ForbiddenException(
                'You are not allowed to manage appointments.',
            );
        }
    }

    // DOCTOR HELPERS

    private async getActiveDoctor(doctorId: string) {
        this.validateId(doctorId);

        const doctor = await this.prisma.doctor.findFirst({
            where: {
                id: doctorId,
                isActive: true,
                user: {
                    is: { isActive: true },
                },
                department: {
                    is: { isActive: true },
                },
            },
            select: {
                id: true,
                fullName: true,
                specialization: true,
                department: {
                    select: {
                        name: true,
                    },
                },
            },
        });

        if (!doctor) {
            throw new NotFoundException(
                'Active doctor not found.',
            );
        }

        return doctor;
    }

    private async assertDoctorActive(
        tx: Prisma.TransactionClient,
        doctorId: string,
    ): Promise<void> {
        const doctor = await tx.doctor.findFirst({
            where: {
                id: doctorId,
                isActive: true,
                user: {
                    is: { isActive: true },
                },
                department: {
                    is: { isActive: true },
                },
            },
            select: {
                id: true,
            },
        });

        if (!doctor) {
            throw new NotFoundException(
                'Active doctor not found.',
            );
        }
    }

    // SCHEDULE HELPERS

    private async findMatchingSchedule(
        tx: Prisma.TransactionClient,
        doctorId: string,
        startAt: Date,
    ) {
        const parts = this.getHospitalParts(startAt);

        const schedules = await tx.doctorSchedule.findMany({
            where: {
                doctorId,
                dayOfWeek: parts.dayOfWeek,
                isActive: true,
            },
            orderBy: {
                startTime: 'asc',
            },
        });

        const startMinutes = this.toMinutes(parts.time);

        const schedule = schedules.find((item) => {
            const shiftStart = this.toMinutes(item.startTime);
            const shiftEnd = this.toMinutes(item.endTime);

            if (
                startMinutes < shiftStart ||
                startMinutes >= shiftEnd
            ) {
                return false;
            }

            const duration = item.slotDurationMinutes;
            const endMinutes = startMinutes + duration;

            // Appointment must fit completely inside the shift.
            if (endMinutes > shiftEnd) {
                return false;
            }

            // Appointment must align with the schedule's slot intervals.
            if (
                (startMinutes - shiftStart) % duration !== 0
            ) {
                return false;
            }

            // Appointment must not overlap the doctor's break.
            if (
                item.breakStartTime &&
                item.breakEndTime
            ) {
                const breakStart = this.toMinutes(
                    item.breakStartTime,
                );

                const breakEnd = this.toMinutes(
                    item.breakEndTime,
                );

                if (
                    startMinutes < breakEnd &&
                    endMinutes > breakStart
                ) {
                    return false;
                }
            }

            return true;
        });

        if (!schedule) {
            throw new ConflictException(
                "The selected time is outside the doctor's available schedule.",
            );
        }

        return schedule;
    }

    // DAY LOCK HELPERS

    private async ensureDayLock(
        doctorId: string,
        dateKey: string,
    ): Promise<void> {
        try {
            await this.prisma.doctorDayLock.upsert({
                where: {
                    doctorId_dateKey: {
                        doctorId,
                        dateKey,
                    },
                },
                create: {
                    doctorId,
                    dateKey,
                },
                update: {},
            });
        } catch (error) {
            // Handle the race where another request creates
            // the same doctor/date lock first.
            const isDuplicate =
                error instanceof
                Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002';

            if (!isDuplicate) {
                throw error;
            }

            const existing =
                await this.prisma.doctorDayLock.findUnique({
                    where: {
                        doctorId_dateKey: {
                            doctorId,
                            dateKey,
                        },
                    },
                    select: {
                        id: true,
                    },
                });

            if (!existing) {
                throw error;
            }
        }
    }

    private async acquireDayLock(
        tx: Prisma.TransactionClient,
        doctorId: string,
        dateKey: string,
    ): Promise<void> {
        await tx.doctorDayLock.update({
            where: {
                doctorId_dateKey: {
                    doctorId,
                    dateKey,
                },
            },
            data: {
                lockVersion: {
                    increment: 1,
                },
            },
        });
    }

    // APPOINTMENT CONFLICT HELPER

    private async assertNoConflict(
        tx: Prisma.TransactionClient,
        doctorId: string,
        startAt: Date,
        endAt: Date,
        excludeAppointmentId?: string,
    ): Promise<void> {
        const conflict = await tx.appointment.findFirst({
            where: {
                doctorId,
                status: {
                    in: ACTIVE_STATUSES,
                },
                startAt: {
                    lt: endAt,
                },
                endAt: {
                    gt: startAt,
                },
                ...(excludeAppointmentId && {
                    id: {
                        not: excludeAppointmentId,
                    },
                }),
            },
            select: {
                id: true,
            },
        });

        if (conflict) {
            throw new ConflictException(
                'This appointment slot is no longer available.',
            );
        }
    }

    // TRANSACTION RETRY

    private async runWithTransactionRetry<T>(
        operation: (tx: Prisma.TransactionClient) => Promise<T>,
        retries = 3,
    ): Promise<T> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await this.prisma.$transaction(
                    async (tx) => operation(tx),
                );
            } catch (error) {
                const isRetryable =
                    error instanceof Prisma.PrismaClientKnownRequestError &&
                    error.code === 'P2034';

                if (!isRetryable || attempt === retries) {
                    throw error;
                }
            }
        }

        throw new Error('Transaction failed after maximum retries.');
    }

    // 1. CHECK AVAILABLE SLOTS

    async checkAvailability(
        dto: CheckAvailabilityDto,
    ) {
        const date = this.parseLocalDate(dto.date);

        const doctor = await this.getActiveDoctor(
            dto.doctorId,
        );

        const dayOfWeek = date.getUTCDay();

        const schedules =
            await this.prisma.doctorSchedule.findMany({
                where: {
                    doctorId: doctor.id,
                    dayOfWeek,
                    isActive: true,
                },
                orderBy: {
                    startTime: 'asc',
                },
            });

        const dayStart = this.localDateTimeToUtc(
            dto.date,
            '00:00',
        );

        const nextDate = new Date(date);

        nextDate.setUTCDate(
            nextDate.getUTCDate() + 1,
        );

        const nextDateKey = nextDate
            .toISOString()
            .slice(0, 10);

        const dayEnd = this.localDateTimeToUtc(
            nextDateKey,
            '00:00',
        );

        const appointments =
            await this.prisma.appointment.findMany({
                where: {
                    doctorId: doctor.id,
                    status: {
                        in: ACTIVE_STATUSES,
                    },
                    startAt: {
                        lt: dayEnd,
                    },
                    endAt: {
                        gt: dayStart,
                    },
                },
                select: {
                    startAt: true,
                    endAt: true,
                },
            });

        const now = Date.now();

        const slots: Array<{
            startAt: string;
            endAt: string;
            available: boolean;
        }> = [];

        for (const schedule of schedules) {
            const shiftStart = this.toMinutes(
                schedule.startTime,
            );

            const shiftEnd = this.toMinutes(
                schedule.endTime,
            );

            const duration =
                schedule.slotDurationMinutes;

            for (
                let minute = shiftStart;
                minute + duration <= shiftEnd;
                minute += duration
            ) {
                const hour = String(
                    Math.floor(minute / 60),
                ).padStart(2, '0');

                const mins = String(
                    minute % 60,
                ).padStart(2, '0');

                const time = `${hour}:${mins}`;

                const endMinute = minute + duration;

                if (
                    schedule.breakStartTime &&
                    schedule.breakEndTime
                ) {
                    const breakStart = this.toMinutes(
                        schedule.breakStartTime,
                    );

                    const breakEnd = this.toMinutes(
                        schedule.breakEndTime,
                    );

                    if (
                        minute < breakEnd &&
                        endMinute > breakStart
                    ) {
                        continue;
                    }
                }

                const startAt =
                    this.localDateTimeToUtc(
                        dto.date,
                        time,
                    );

                const endAt = new Date(
                    startAt.getTime() +
                    duration * 60_000,
                );

                // Do not return past appointment slots.
                if (startAt.getTime() <= now) {
                    continue;
                }

                const booked = appointments.some(
                    (appointment) =>
                        startAt < appointment.endAt &&
                        endAt > appointment.startAt,
                );

                slots.push({
                    startAt: startAt.toISOString(),
                    endAt: endAt.toISOString(),
                    available: !booked,
                });
            }
        }

        return {
            doctor,
            date: dto.date,
            timezone: HOSPITAL_TIMEZONE,
            slots,
            availableCount: slots.filter(
                (slot) => slot.available,
            ).length,
        };
    }

    // 2. CREATE APPOINTMENT

    async create(
        dto: CreateAppointmentDto,
        actor: Actor,
    ) {
        this.validateActor(actor);
        this.validateId(dto.patientId);

        const startAt = this.assertValidStartAt(
            dto.startAt,
        );

        const doctor = await this.getActiveDoctor(
            dto.doctorId,
        );

        const parts = this.getHospitalParts(startAt);
        const dateKey = parts.date;

        // Ensure the lock document exists before the transaction.
        await this.ensureDayLock(
            doctor.id,
            dateKey,
        );

        return this.runWithTransactionRetry(() =>
            this.prisma.$transaction(async (tx) => {
                await this.acquireDayLock(
                    tx,
                    doctor.id,
                    dateKey,
                );

                // Revalidate doctor inside transaction.
                await this.assertDoctorActive(
                    tx,
                    doctor.id,
                );

                // Verify patient inside transaction.
                const patient =
                    await tx.patient.findUnique({
                        where: {
                            id: dto.patientId,
                        },
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    });

                if (!patient) {
                    throw new NotFoundException(
                        'Patient not found.',
                    );
                }

                const schedule =
                    await this.findMatchingSchedule(
                        tx,
                        doctor.id,
                        startAt,
                    );

                const endAt = new Date(
                    startAt.getTime() +
                    schedule.slotDurationMinutes *
                    60_000,
                );

                await this.assertNoConflict(
                    tx,
                    doctor.id,
                    startAt,
                    endAt,
                );

                const bookingSource =
                    actor.role === UserRole.ADMIN
                        ? BookingSource.ADMIN
                        : BookingSource.RECEPTIONIST;

                return tx.appointment.create({
                    data: {
                        patientId: patient.id,
                        doctorId: doctor.id,
                        startAt,
                        endAt,
                        status:
                            AppointmentStatus.CONFIRMED,
                        bookingSource,
                        reason: dto.reason,
                    },
                    include: {
                        patient: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                phone: true,
                            },
                        },
                        doctor: {
                            select: {
                                id: true,
                                fullName: true,
                                specialization: true,
                            },
                        },
                    },
                });
            }),
        );
    }

    // 3. LIST APPOINTMENTS

    async findAll(query: QueryAppointmentDto) {
        const page = query.page ?? 1;
        const limit = query.limit ?? 10;

        if (
            !Number.isInteger(page) ||
            page < 1
        ) {
            throw new BadRequestException(
                'Page must be a positive integer.',
            );
        }

        if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100
        ) {
            throw new BadRequestException(
                'Limit must be between 1 and 100.',
            );
        }

        if (query.patientId) {
            this.validateId(query.patientId);
        }

        if (query.doctorId) {
            this.validateId(query.doctorId);
        }

        const from = query.from
            ? this.parseDateTime(query.from)
            : undefined;

        const to = query.to
            ? this.parseDateTime(query.to)
            : undefined;

        if (
            from &&
            to &&
            from.getTime() > to.getTime()
        ) {
            throw new BadRequestException(
                '"from" must be earlier than or equal to "to".',
            );
        }

        const where: Prisma.AppointmentWhereInput = {
            ...(query.patientId && {
                patientId: query.patientId,
            }),

            ...(query.doctorId && {
                doctorId: query.doctorId,
            }),

            ...(query.status && {
                status: query.status,
            }),

            ...((from || to) && {
                startAt: {
                    ...(from && {
                        gte: from,
                    }),
                    ...(to && {
                        lte: to,
                    }),
                },
            }),
        };

        const [data, total] = await Promise.all([
            this.prisma.appointment.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: {
                    startAt: 'desc',
                },
                include: {
                    patient: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            phone: true,
                        },
                    },
                    doctor: {
                        select: {
                            id: true,
                            fullName: true,
                            specialization: true,
                        },
                    },
                },
            }),

            this.prisma.appointment.count({
                where,
            }),
        ]);

        return {
            data,
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(
                    total / limit,
                ),
            },
        };
    }

    // 4. GET APPOINTMENT DETAILS

    async findOne(id: string) {
        this.validateId(id);

        const appointment =
            await this.prisma.appointment.findUnique({
                where: {
                    id,
                },
                include: {
                    patient: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            phone: true,
                            email: true,
                        },
                    },
                    doctor: {
                        select: {
                            id: true,
                            fullName: true,
                            specialization: true,
                            qualification: true,
                            department: {
                                select: {
                                    id: true,
                                    name: true,
                                },
                            },
                        },
                    },
                },
            });

        if (!appointment) {
            throw new NotFoundException(
                'Appointment not found.',
            );
        }

        return appointment;
    }

    // 5. CANCEL APPOINTMENT

    async cancel(
        id: string,
        dto: CancelAppointmentDto,
    ) {
        this.validateId(id);

        const result =
            await this.prisma.appointment.updateMany({
                where: {
                    id,
                    status: {
                        in: ACTIVE_STATUSES,
                    },
                },
                data: {
                    status:
                        AppointmentStatus.CANCELLED,
                    cancellationReason:
                        dto.cancellationReason,
                    cancelledAt: new Date(),
                },
            });

        if (result.count === 0) {
            const existing =
                await this.prisma.appointment.findUnique({
                    where: {
                        id,
                    },
                    select: {
                        id: true,
                    },
                });

            if (!existing) {
                throw new NotFoundException(
                    'Appointment not found.',
                );
            }

            throw new ConflictException(
                'Only pending or confirmed appointments can be cancelled.',
            );
        }

        return this.findOne(id);
    }

    // 6. RESCHEDULE APPOINTMENT

    async reschedule(
        id: string,
        dto: RescheduleAppointmentDto,
    ) {
        this.validateId(id);

        // Initial read is used to determine which day locks
        // must be acquired. The appointment is revalidated
        // inside the transaction.
        const appointment = await this.findOne(id);

        if (
            !ACTIVE_STATUSES.includes(
                appointment.status,
            )
        ) {
            throw new ConflictException(
                'Only pending or confirmed appointments can be rescheduled.',
            );
        }

        const startAt = this.assertValidStartAt(
            dto.startAt,
        );

        const newParts =
            this.getHospitalParts(startAt);

        const oldParts =
            this.getHospitalParts(
                appointment.startAt,
            );

        // Acquire locks in deterministic order to reduce
        // transaction conflicts.
        const dateKeys = [
            ...new Set([
                newParts.date,
                oldParts.date,
            ]),
        ].sort();

        for (const dateKey of dateKeys) {
            await this.ensureDayLock(
                appointment.doctorId,
                dateKey,
            );
        }

        return this.runWithTransactionRetry(() =>
            this.prisma.$transaction(async (tx) => {
                for (const dateKey of dateKeys) {
                    await this.acquireDayLock(
                        tx,
                        appointment.doctorId,
                        dateKey,
                    );
                }

                // Re-fetch the appointment inside the transaction.
                const current =
                    await tx.appointment.findUnique({
                        where: {
                            id,
                        },
                    });

                if (!current) {
                    throw new NotFoundException(
                        'Appointment not found.',
                    );
                }

                if (
                    !ACTIVE_STATUSES.includes(
                        current.status,
                    )
                ) {
                    throw new ConflictException(
                        'Only pending or confirmed appointments can be rescheduled.',
                    );
                }

                // Ensure another request has not changed the
                // appointment since our initial read.
                if (
                    current.startAt.getTime() !==
                    appointment.startAt.getTime()
                ) {
                    throw new ConflictException(
                        'This appointment has been modified. Please refresh and try again.',
                    );
                }

                await this.assertDoctorActive(
                    tx,
                    current.doctorId,
                );

                const schedule =
                    await this.findMatchingSchedule(
                        tx,
                        current.doctorId,
                        startAt,
                    );

                const endAt = new Date(
                    startAt.getTime() +
                    schedule.slotDurationMinutes *
                    60_000,
                );

                await this.assertNoConflict(
                    tx,
                    current.doctorId,
                    startAt,
                    endAt,
                    id,
                );

                return tx.appointment.update({
                    where: {
                        id,
                    },
                    data: {
                        startAt,
                        endAt,
                    },
                    include: {
                        patient: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                            },
                        },
                        doctor: {
                            select: {
                                id: true,
                                fullName: true,
                                specialization: true,
                            },
                        },
                    },
                });
            }),
        );
    }

    //  COMPLETE APPOINTMENT / MARK NO-SHOW

    async updateStatus(
        id: string,
        status: Extract<
            AppointmentStatus,
            'COMPLETED' | 'NO_SHOW'
        >,
    ) {
        this.validateId(id);

        const appointment = await this.findOne(id);

        if (
            appointment.status !==
            AppointmentStatus.CONFIRMED
        ) {
            throw new ConflictException(
                'Only confirmed appointments can be completed or marked as no-show.',
            );
        }

        const now = new Date();

        if (
            status === AppointmentStatus.COMPLETED &&
            appointment.endAt.getTime() > now.getTime()
        ) {
            throw new BadRequestException(
                'An appointment cannot be completed before its scheduled end time.',
            );
        }

        if (
            status === AppointmentStatus.NO_SHOW &&
            appointment.startAt.getTime() > now.getTime()
        ) {
            throw new BadRequestException(
                'A future appointment cannot be marked as no-show.',
            );
        }

        // Apply the time condition and status condition in
        // the database update to avoid stale status/time checks.
        const where: Prisma.AppointmentWhereInput = {
            id,
            status: AppointmentStatus.CONFIRMED,
            ...(status === AppointmentStatus.COMPLETED
                ? {
                    endAt: {
                        lte: now,
                    },
                }
                : {
                    startAt: {
                        lte: now,
                    },
                }),
        };

        const result =
            await this.prisma.appointment.updateMany({
                where,
                data: {
                    status,
                },
            });

        if (result.count === 0) {
            throw new ConflictException(
                'Appointment status or schedule has changed. Please refresh and try again.',
            );
        }

        return this.findOne(id);
    }


    async createFromVoice(input: {
        patientId: string;
        doctorId: string;
        startAt: string;
        idempotencyKey: string;
        reason?: string;
    }) {
        const appointmentInclude = {
            doctor: {
                select: {
                    id: true,
                    fullName: true,
                    specialization: true,
                },
            },
        };

        this.validateId(input.patientId);
        this.validateId(input.doctorId);

        // Idempotency: return the existing appointment on webhook retry.
        const existing = await this.prisma.appointment.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            include: appointmentInclude,
        });

        if (existing) {
            return existing;
        }

        const startAt = new Date(input.startAt);

        if (
            Number.isNaN(startAt.getTime()) ||
            !/^\d{4}-\d{2}-\d{2}T/.test(input.startAt) ||
            !/(Z|[+-]\d{2}:\d{2})$/.test(input.startAt)
        ) {
            throw new BadRequestException('Invalid appointment date and time.');
        }

        if (
            startAt.getTime() <= Date.now() ||
            startAt.getUTCSeconds() !== 0 ||
            startAt.getUTCMilliseconds() !== 0
        ) {
            throw new BadRequestException('Please select a valid future appointment slot.');
        }

        // Convert UTC timestamp to hospital local time (Asia/Kolkata).
        const localDate = new Date(startAt.getTime() + 330 * 60 * 1000);

        const year = localDate.getUTCFullYear();
        const month = localDate.getUTCMonth() + 1;
        const day = localDate.getUTCDate();

        const dateKey =
            `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        const dayOfWeek = new Date(
            Date.UTC(year, month - 1, day),
        ).getUTCDay();

        const localStartMinutes =
            localDate.getUTCHours() * 60 + localDate.getUTCMinutes();

        const doctor = await this.getActiveDoctor(input.doctorId);

        const schedule = await this.prisma.doctorSchedule.findFirst({
            where: {
                doctorId: doctor.id,
                dayOfWeek,
                isActive: true,
            },
        });

        // Check all active shifts for the doctor.
        const schedules = await this.prisma.doctorSchedule.findMany({
            where: {
                doctorId: doctor.id,
                dayOfWeek,
                isActive: true,
            },
        });

        const matchingSchedule = schedules.find((item) => {
            const scheduleStart = this.toMinutes(item.startTime);
            const scheduleEnd = this.toMinutes(item.endTime);
            const duration = item.slotDurationMinutes;

            const slotEnd = localStartMinutes + duration;

            const aligned =
                localStartMinutes >= scheduleStart &&
                slotEnd <= scheduleEnd &&
                (localStartMinutes - scheduleStart) % duration === 0;

            const breakStart = item.breakStartTime
                ? this.toMinutes(item.breakStartTime)
                : null;

            const breakEnd = item.breakEndTime
                ? this.toMinutes(item.breakEndTime)
                : null;

            const overlapsBreak =
                breakStart !== null &&
                breakEnd !== null &&
                localStartMinutes < breakEnd &&
                slotEnd > breakStart;

            return aligned && !overlapsBreak;
        });

        if (!matchingSchedule) {
            throw new BadRequestException(
                'This appointment slot is not part of the doctor schedule.',
            );
        }

        const endAt = new Date(
            startAt.getTime() +
            matchingSchedule.slotDurationMinutes * 60 * 1000,
        );

        // Ensure the day lock exists before acquiring it.
        await this.ensureDayLock(input.doctorId, dateKey);

        try {
            return await this.runWithTransactionRetry(async (tx) => {
                await this.acquireDayLock(tx, input.doctorId, dateKey);

                // Recheck doctor status inside the transaction.
                await this.assertDoctorActive(tx, input.doctorId);

                // Check overlapping active appointments.
                await this.assertNoConflict(
                    tx,
                    input.doctorId,
                    startAt,
                    endAt,
                );

                // Check idempotency again inside the transaction.
                const duplicate = await tx.appointment.findUnique({
                    where: { idempotencyKey: input.idempotencyKey },
                    include: appointmentInclude,
                });

                if (duplicate) {
                    return duplicate;
                }

                return tx.appointment.create({
                    data: {
                        patientId: input.patientId,
                        doctorId: input.doctorId,
                        startAt,
                        endAt,
                        status: AppointmentStatus.CONFIRMED,
                        bookingSource: BookingSource.VOICE_AI,
                        reason: input.reason?.trim() || undefined,
                        idempotencyKey: input.idempotencyKey,
                        bookingReference: generateBookingReference(),
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
            });
        } catch (error) {
            // A concurrent retry may have committed the same idempotency key.
            const duplicate = await this.prisma.appointment.findUnique({
                where: { idempotencyKey: input.idempotencyKey },
                include: appointmentInclude,
            });

            if (duplicate) {
                return duplicate;
            }

            throw error;
        }
    }
}
