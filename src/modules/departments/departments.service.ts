
import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service.js';
import { CreateDepartmentDto } from './dto/create-department.dto.js';
import { QueryDepartmentDto } from './dto/query-department.dto.js';
import { UpdateDepartmentDto } from './dto/update-department.dto.js';


@Injectable()
export class DepartmentsService {
    constructor(private readonly prisma: PrismaService) { }

    async create(dto: CreateDepartmentDto) {
        try {
            return await this.prisma.department.create({
                data: {
                    name: dto.name,
                    code: dto.code,
                    description: dto.description,
                },
            });
        } catch (error) {
            this.handlePrismaError(error);
        }
    }

    async findAll(query: QueryDepartmentDto) {
        const page = query.page ?? 1;
        const limit = query.limit ?? 10;
        const skip = (page - 1) * limit;

        const search = query.search?.trim();

        const where: Prisma.DepartmentWhereInput = {
            isActive: true,
            ...(search
                ? {
                    OR: [
                        { name: { contains: search } },
                        { code: { contains: search } },
                    ],
                }
                : {}),
        };

        const [data, total] = await Promise.all([
            this.prisma.department.findMany({
                where,
                skip,
                take: limit,
                orderBy: { name: 'asc' },
                include: {
                    _count: {
                        select: { doctors: true },
                    },
                },
            }),
            this.prisma.department.count({ where }),
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

    async findOne(id: string) {
        const department = await this.prisma.department.findUnique({
            where: { id },
            include: {
                _count: {
                    select: { doctors: true },
                },
            },
        });

        if (!department) {
            throw new NotFoundException('Department not found.');
        }

        return department;
    }

    async update(id: string, dto: UpdateDepartmentDto) {
        await this.findOne(id);

        try {
            return await this.prisma.department.update({
                where: { id },
                data: {
                    ...(dto.name !== undefined && { name: dto.name }),
                    ...(dto.code !== undefined && { code: dto.code }),
                    ...(dto.description !== undefined && {
                        description: dto.description,
                    }),
                },
            });
        } catch (error) {
            this.handlePrismaError(error);
        }
    }

    async deactivate(id: string) {
        const department = await this.findOne(id);

        if (!department.isActive) {
            throw new ConflictException('Department is already inactive.');
        }

        // Do not deactivate a department that still has active doctors.
        const activeDoctors = await this.prisma.doctor.count({
            where: {
                departmentId: id,
                isActive: true,
            },
        });

        if (activeDoctors > 0) {
            throw new ConflictException(
                'Deactivate or reassign active doctors before deactivating this department.',
            );
        }

        return this.prisma.department.update({
            where: { id },
            data: { isActive: false },
        });
    }

    private handlePrismaError(error: unknown): never {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
        ) {
            throw new ConflictException(
                'A department with this name or code already exists.',
            );
        }

        throw error;
    }
}
