
import {
    Injectable,
} from '@nestjs/common';

import {
    AppointmentStatus,
    Prisma,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service.js';
import { DashboardTrendsDto } from './dto/dashboard-trends.dto.js';

const HOSPITAL_OFFSET_MINUTES = 330;
const HOSPITAL_OFFSET = '+05:30';

const APPOINTMENT_STATUSES: AppointmentStatus[] = [
    AppointmentStatus.PENDING,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.NO_SHOW,
];

@Injectable()
export class DashboardService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    // -------------------------------------------------------
    // DATE HELPERS - ASIA/KOLKATA
    // -------------------------------------------------------

    private getHospitalDate(date: Date): string {
        const local = new Date(
            date.getTime() +
            HOSPITAL_OFFSET_MINUTES * 60_000,
        );

        return local.toISOString().slice(0, 10);
    }

    private localDateTimeToUtc(
        date: string,
        time: string,
    ): Date {
        return new Date(
            `${date}T${time}:00${HOSPITAL_OFFSET}`,
        );
    }

    private addDays(
        date: string,
        days: number,
    ): string {
        const result = new Date(
            `${date}T00:00:00.000Z`,
        );

        result.setUTCDate(
            result.getUTCDate() + days,
        );

        return result.toISOString().slice(0, 10);
    }

    private getDayRange(date: string) {
        const nextDate = this.addDays(date, 1);

        return {
            start: this.localDateTimeToUtc(
                date,
                '00:00',
            ),
            end: this.localDateTimeToUtc(
                nextDate,
                '00:00',
            ),
        };
    }

    private getTodayRange() {
        const today = this.getHospitalDate(
            new Date(),
        );

        return {
            date: today,
            ...this.getDayRange(today),
        };
    }

    private getAppointmentDateFilter(
        start: Date,
        end: Date,
    ): Prisma.AppointmentWhereInput {
        return {
            startAt: {
                gte: start,
                lt: end,
            },
        };
    }

    // -------------------------------------------------------
    // 1. DASHBOARD OVERVIEW
    // -------------------------------------------------------

    async getOverview() {
        const today = this.getTodayRange();

        const todayFilter =
            this.getAppointmentDateFilter(
                today.start,
                today.end,
            );

        const [
            totalAppointmentsToday,
            confirmedAppointmentsToday,
            pendingAppointmentsToday,
            cancelledAppointmentsToday,
            completedAppointmentsToday,
            noShowAppointmentsToday,
            totalPatients,
            activeDoctors,
            totalDepartments,
        ] = await Promise.all([
            this.prisma.appointment.count({
                where: todayFilter,
            }),

            this.prisma.appointment.count({
                where: {
                    ...todayFilter,
                    status: AppointmentStatus.CONFIRMED,
                },
            }),

            this.prisma.appointment.count({
                where: {
                    ...todayFilter,
                    status: AppointmentStatus.PENDING,
                },
            }),

            this.prisma.appointment.count({
                where: {
                    ...todayFilter,
                    status: AppointmentStatus.CANCELLED,
                },
            }),

            this.prisma.appointment.count({
                where: {
                    ...todayFilter,
                    status: AppointmentStatus.COMPLETED,
                },
            }),

            this.prisma.appointment.count({
                where: {
                    ...todayFilter,
                    status: AppointmentStatus.NO_SHOW,
                },
            }),

            this.prisma.patient.count(),

            this.prisma.doctor.count({
                where: {
                    isActive: true,
                    user: {
                        is: {
                            isActive: true,
                        },
                    },
                    department: {
                        is: {
                            isActive: true,
                        },
                    },
                },
            }),

            this.prisma.department.count({
                where: {
                    isActive: true,
                },
            }),
        ]);

        return {
            date: today.date,
            timezone: 'Asia/Kolkata',

            appointments: {
                total: totalAppointmentsToday,
                confirmed: confirmedAppointmentsToday,
                pending: pendingAppointmentsToday,
                cancelled: cancelledAppointmentsToday,
                completed: completedAppointmentsToday,
                noShow: noShowAppointmentsToday,
            },

            patients: {
                total: totalPatients,
            },

            doctors: {
                active: activeDoctors,
            },

            departments: {
                active: totalDepartments,
            },
        };
    }

    // -------------------------------------------------------
    // 2. APPOINTMENT TRENDS
    // -------------------------------------------------------

    async getAppointmentTrends(
        dto: DashboardTrendsDto,
    ) {
        const days = dto.days ?? 7;

        const today = this.getHospitalDate(
            new Date(),
        );

        const startDate = this.addDays(
            today,
            -(days - 1),
        );

        const dates = Array.from(
            { length: days },
            (_, index) =>
                this.addDays(startDate, index),
        );

        const trends = await Promise.all(
            dates.map(async (date) => {
                const range = this.getDayRange(date);

                const count =
                    await this.prisma.appointment.count({
                        where: {
                            startAt: {
                                gte: range.start,
                                lt: range.end,
                            },
                        },
                    });

                return {
                    date,
                    appointments: count,
                };
            }),
        );

        const totalAppointments = trends.reduce(
            (total, item) =>
                total + item.appointments,
            0,
        );

        return {
            period: `${days} days`,
            timezone: 'Asia/Kolkata',
            totalAppointments,
            data: trends,
        };
    }

    // -------------------------------------------------------
    // 3. APPOINTMENT STATUS BREAKDOWN
    // -------------------------------------------------------

    async getAppointmentStatus() {
        const today = this.getTodayRange();

        const statusCounts = await Promise.all(
            APPOINTMENT_STATUSES.map(
                async (status) => {
                    const count =
                        await this.prisma.appointment.count({
                            where: {
                                startAt: {
                                    gte: today.start,
                                    lt: today.end,
                                },
                                status,
                            },
                        });

                    return {
                        status,
                        count,
                    };
                },
            ),
        );

        const total = statusCounts.reduce(
            (sum, item) => sum + item.count,
            0,
        );

        return {
            date: today.date,
            timezone: 'Asia/Kolkata',
            total,
            data: statusCounts,
        };
    }

    // -------------------------------------------------------
    // 4. RECENT APPOINTMENTS
    // -------------------------------------------------------

    async getRecentAppointments(limit = 10) {
        if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100
        ) {
            throw new Error(
                'Limit must be between 1 and 100.',
            );
        }

        const appointments =
            await this.prisma.appointment.findMany({
                take: limit,
                orderBy: {
                    createdAt: 'desc',
                },
                select: {
                    id: true,
                    startAt: true,
                    endAt: true,
                    status: true,
                    bookingSource: true,
                    createdAt: true,

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

        return {
            data: appointments,
            total: appointments.length,
        };
    }

    // -------------------------------------------------------
    // 5. DEPARTMENT STATISTICS
    // -------------------------------------------------------

    async getDepartmentStats() {
        const today = this.getHospitalDate(
            new Date(),
        );

        const startDate = this.addDays(
            today,
            -29,
        );

        const start = this.getDayRange(
            startDate,
        ).start;

        const end = this.getDayRange(
            this.addDays(today, 1),
        ).start;

        const departments =
            await this.prisma.department.findMany({
                where: {
                    isActive: true,
                },
                select: {
                    id: true,
                    name: true,
                    code: true,

                    doctors: {
                        where: {
                            isActive: true,
                            user: {
                                is: {
                                    isActive: true,
                                },
                            },
                        },
                        select: {
                            id: true,
                        },
                    },
                },
                orderBy: {
                    name: 'asc',
                },
            });

        const data = await Promise.all(
            departments.map(async (department) => {
                const appointmentCount =
                    await this.prisma.appointment.count({
                        where: {
                            startAt: {
                                gte: start,
                                lt: end,
                            },
                            doctor: {
                                is: {
                                    departmentId: department.id,
                                },
                            },
                        },
                    });

                return {
                    departmentId: department.id,
                    departmentName: department.name,
                    departmentCode: department.code,
                    activeDoctors: department.doctors.length,
                    appointments: appointmentCount,
                };
            }),
        );

        return {
            period: 'Last 30 days',
            timezone: 'Asia/Kolkata',
            data,
        };
    }
}
