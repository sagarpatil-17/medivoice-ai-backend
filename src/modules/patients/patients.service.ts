
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { LookupPatientDto } from './dto/lookup-patient.dto.js';
import { QueryPatientDto } from './dto/query-patient.dto.js';
import { UpdatePatientDto } from './dto/update-patient.dto.js';
import { VerifyPatientDto } from './dto/verify-patient.dto.js';


@Injectable()
export class PatientsService {
    constructor(private readonly prisma: PrismaService) { }

    private validateId(id: string): void {
        if (!/^[a-fA-F0-9]{24}$/.test(id)) {
            throw new BadRequestException('Invalid patient ID.');
        }
    }

    private parseDateOfBirth(value: string): Date {
        // Store date-only values consistently at UTC midnight.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new BadRequestException(
                'Date of birth must use YYYY-MM-DD format.',
            );
        }

        const date = new Date(`${value}T00:00:00.000Z`);

        if (
            Number.isNaN(date.getTime()) ||
            date.toISOString().slice(0, 10) !== value
        ) {
            throw new BadRequestException('Invalid date of birth.');
        }

        if (date.getTime() > Date.now()) {
            throw new BadRequestException(
                'Date of birth cannot be in the future.',
            );
        }

        return date;
    }

    // REGISTER PATIENT
    async create(dto: CreatePatientDto) {
        const dateOfBirth = dto.dateOfBirth
            ? this.parseDateOfBirth(dto.dateOfBirth)
            : undefined;

        return this.prisma.patient.create({
            data: {
                firstName: dto.firstName,
                lastName: dto.lastName,
                phone: dto.phone,
                email: dto.email,
                dateOfBirth,
                gender: dto.gender,
                address: dto.address,
                notes: dto.notes,
            },
        });
    }

    // LIST AND SEARCH PATIENTS
    async findAll(query: QueryPatientDto) {
        const page = query.page ?? 1;
        const limit = query.limit ?? 10;
        const skip = (page - 1) * limit;
        const search = query.search?.trim();

        const where: Prisma.PatientWhereInput = search
            ? {
                OR: [
                    { firstName: { contains: search } },
                    { lastName: { contains: search } },
                    { phone: { contains: search } },
                    { email: { contains: search } },
                ],
            }
            : {};

        const [data, total] = await Promise.all([
            this.prisma.patient.findMany({
                where,
                skip,
                take: limit,
                orderBy: {
                    createdAt: 'desc',
                },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                    dateOfBirth: true,
                    gender: true,
                    createdAt: true,
                },
            }),

            this.prisma.patient.count({ where }),
        ]);

        return {
            data,
            meta: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    // GET PATIENT DETAILS
    async findOne(id: string) {
        this.validateId(id);

        const patient = await this.prisma.patient.findUnique({
            where: { id },
        });

        if (!patient) {
            throw new NotFoundException('Patient not found.');
        }

        return patient;
    }

    // FIND PATIENTS BY PHONE NUMBER
    async lookupByPhone(dto: LookupPatientDto) {
        const patients = await this.prisma.patient.findMany({
            where: {
                phone: dto.phone,
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
            },
            take: 10,
        });

        return {
            count: patients.length,
            matches: patients.map((patient) => ({
                id: patient.id,
                firstName: patient.firstName,
                lastInitial: patient.lastName.charAt(0),
            })),
            requiresVerification: true,
        };
    }

    // VERIFY PATIENT USING PHONE + DATE OF BIRTH
    async verify(dto: VerifyPatientDto) {
        const dateOfBirth = this.parseDateOfBirth(dto.dateOfBirth);

        const nextDay = new Date(dateOfBirth);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);

        const matches = await this.prisma.patient.findMany({
            where: {
                phone: dto.phone,
                dateOfBirth: {
                    gte: dateOfBirth,
                    lt: nextDay,
                },
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
            },
            take: 2,
        });

        if (matches.length === 0) {
            throw new UnauthorizedException(
                'Unable to verify patient details.',
            );
        }

        if (matches.length > 1) {
            throw new ConflictException(
                'Multiple patients match these details. Additional verification is required.',
            );
        }

        const patient = matches[0];

        return {
            verified: true,
            patient: {
                id: patient.id,
                firstName: patient.firstName,
                lastName: patient.lastName,
            },
        };
    }

    // UPDATE PATIENT
    async update(id: string, dto: UpdatePatientDto) {
        await this.findOne(id);

        const dateOfBirth =
            typeof dto.dateOfBirth === 'string'
                ? this.parseDateOfBirth(dto.dateOfBirth)
                : undefined;

        return this.prisma.patient.update({
            where: { id },
            data: {
                ...(typeof dto.firstName === 'string' && {
                    firstName: dto.firstName,
                }),
                ...(typeof dto.lastName === 'string' && {
                    lastName: dto.lastName,
                }),
                ...(typeof dto.phone === 'string' && {
                    phone: dto.phone,
                }),
                ...(typeof dto.email === 'string' && {
                    email: dto.email,
                }),
                ...(dateOfBirth && { dateOfBirth }),
                ...(dto.gender !== undefined &&
                    dto.gender !== null && {
                    gender: dto.gender,
                }),
                ...(typeof dto.address === 'string' && {
                    address: dto.address,
                }),
                ...(typeof dto.notes === 'string' && {
                    notes: dto.notes,
                }),
            },
        });
    }

    // GET PATIENT APPOINTMENT HISTORY
    async getAppointmentHistory(id: string) {
        await this.findOne(id);

        const appointments = await this.prisma.appointment.findMany({
            where: {
                patientId: id,
            },
            orderBy: {
                startAt: 'desc',
            },
            select: {
                id: true,
                startAt: true,
                endAt: true,
                status: true,
                bookingSource: true,
                reason: true,
                doctor: {
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
                },
            },
        });

        return {
            patientId: id,
            total: appointments.length,
            appointments,
        };
    }
}
