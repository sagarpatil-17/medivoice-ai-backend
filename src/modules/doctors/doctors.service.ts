
import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { hashPassword } from '../../common/utils/password.util.js';
import { CreateDoctorDto } from './dto/create-doctor.dto.js';
import { QueryDoctorDto } from './dto/query-doctor.dto.js';
import { UpdateDoctorDto } from './dto/update-doctor.dto.js';



@Injectable()
export class DoctorsService {
    constructor(private readonly prisma: PrismaService) { }

    private validateId(id: string): void {
        if (!/^[a-fA-F0-9]{24}$/.test(id)) {
            throw new BadRequestException('Invalid doctor ID.');
        }
    }

    private handlePrismaError(error: unknown): never {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
        ) {
            throw new ConflictException(
                'A user with this email or a doctor with this license number already exists.',
            );
        }

        throw error;
    }

    private async validateDepartment(departmentId: string) {
        const department = await this.prisma.department.findFirst({
            where: {
                id: departmentId,
                isActive: true,
            },
        });

        if (!department) {
            throw new NotFoundException(
                'Active department not found.',
            );
        }

        return department;
    }

    // CREATE DOCTOR + USER ACCOUNT
    async create(dto: CreateDoctorDto) {
        if (Buffer.byteLength(dto.password, 'utf8') > 72) {
            throw new BadRequestException(
                'Password cannot exceed 72 UTF-8 bytes.',
            );
        }

        await this.validateDepartment(dto.departmentId);

        const passwordHash = await hashPassword(dto.password);

        try {
            const created = await this.prisma.user.create({
                data: {
                    name: dto.fullName,
                    email: dto.email,
                    passwordHash,
                    phone: dto.phone,
                    role: UserRole.DOCTOR,
                    doctor: {
                        create: {
                            fullName: dto.fullName,
                            specialization: dto.specialization,
                            qualification: dto.qualification,
                            experienceYears: dto.experienceYears,
                            consultationFee: dto.consultationFee,
                            bio: dto.bio,
                            department: {
                                connect: {
                                    id: dto.departmentId,
                                },
                            },
                        },
                    },
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    role: true,
                    isActive: true,
                    doctor: {
                        include: {
                            department: true,
                        },
                    },
                },
            });

            return {
                ...created.doctor,
                user: {
                    id: created.id,
                    name: created.name,
                    email: created.email,
                    phone: created.phone,
                    role: created.role,
                    isActive: created.isActive,
                },
            };
        } catch (error) {
            this.handlePrismaError(error);
        }
    }

    // LIST DOCTORS
    async findAll(query: QueryDoctorDto) {
        const page = query.page ?? 1;
        const limit = query.limit ?? 10;
        const skip = (page - 1) * limit;

        const search = query.search?.trim();

        const where: Prisma.DoctorWhereInput = {
            isActive: query.isActive ?? true,

            ...(query.departmentId && {
                departmentId: query.departmentId,
            }),

            ...(search && {
                OR: [
                    { fullName: { contains: search } },
                    { specialization: { contains: search } },
                ],
            }),
        };

        const [data, total] = await Promise.all([
            this.prisma.doctor.findMany({
                where,
                skip,
                take: limit,
                orderBy: {
                    fullName: 'asc',
                },
                include: {
                    department: true,
                    user: {
                        select: {
                            id: true,
                            email: true,
                            phone: true,
                            isActive: true,
                        },
                    },
                },
            }),

            this.prisma.doctor.count({ where }),
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

    // GET DOCTOR DETAILS
    async findOne(id: string) {
        this.validateId(id);

        const doctor = await this.prisma.doctor.findUnique({
            where: { id },
            include: {
                department: true,
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                        role: true,
                        isActive: true,
                    },
                },
            },
        });

        if (!doctor) {
            throw new NotFoundException('Doctor not found.');
        }

        return doctor;
    }

    // UPDATE DOCTOR
    async update(id: string, dto: UpdateDoctorDto) {
        const doctor = await this.findOne(id);

        if (dto.departmentId) {
            await this.validateDepartment(dto.departmentId);
        }

        try {
            return await this.prisma.$transaction(async (tx) => {
                const updatedDoctor = await tx.doctor.update({
                    where: { id },
                    data: {
                        ...(dto.fullName !== undefined && {
                            fullName: dto.fullName,
                        }),
                        ...(dto.departmentId !== undefined && {
                            department: {
                                connect: { id: dto.departmentId },
                            },
                        }),
                        ...(dto.specialization !== undefined && {
                            specialization: dto.specialization,
                        }),
                        ...(dto.qualification !== undefined && {
                            qualification: dto.qualification,
                        }),
                        ...(dto.experienceYears !== undefined && {
                            experienceYears: dto.experienceYears,
                        }),
                        ...(dto.consultationFee !== undefined && {
                            consultationFee: dto.consultationFee,
                        }),
                        ...(dto.bio !== undefined && {
                            bio: dto.bio,
                        }),
                    },
                    include: {
                        department: true,
                    },
                });

                let updatedUser = doctor.user;

                if (
                    dto.fullName !== undefined ||
                    dto.phone !== undefined
                ) {
                    updatedUser = await tx.user.update({
                        where: {
                            id: doctor.userId,
                        },
                        data: {
                            ...(dto.fullName !== undefined && {
                                name: dto.fullName,
                            }),
                            ...(dto.phone !== undefined && {
                                phone: dto.phone,
                            }),
                        },
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true,
                            role: true,
                            isActive: true,
                        },
                    });
                }

                return {
                    ...updatedDoctor,
                    user: updatedUser,
                };
            });
        } catch (error) {
            this.handlePrismaError(error);
        }
    }

    // DEACTIVATE DOCTOR
    async deactivate(id: string) {
        const doctor = await this.findOne(id);

        if (!doctor.isActive) {
            throw new ConflictException(
                'Doctor is already inactive.',
            );
        }

        return this.prisma.$transaction(async (tx) => {
            const updatedDoctor = await tx.doctor.update({
                where: { id },
                data: { isActive: false },
            });

            await tx.user.update({
                where: { id: doctor.userId },
                data: { isActive: false },
            });

            // Stop future availability from being offered.
            await tx.doctorSchedule.updateMany({
                where: { doctorId: id },
                data: { isActive: false },
            });

            return updatedDoctor;
        });
    }
}
