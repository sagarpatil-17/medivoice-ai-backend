
import {
    Injectable,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';
import { QueryCallsDto } from './dto/query-calls.dto.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class CallsService {
    constructor(
        private readonly prisma: PrismaService,
    ) { }

    // GET ALL CALLS
    async findAll(query: QueryCallsDto) {
        const page = query.page ?? 1;
        const limit = query.limit ?? 10;

        const where: Prisma.CallWhereInput = {};

        if (query.status) {
            where.status = query.status;
        }

        if (query.outcome) {
            where.outcome = query.outcome;
        }

        if (query.search?.trim()) {
            const search = query.search.trim();

            where.OR = [
                { vapiCallId: { contains: search } },
                { customerNumber: { contains: search } },
            ];
        }

        if (query.from || query.to) {
            const from = query.from
                ? new Date(query.from)
                : undefined;

            const to = query.to
                ? new Date(query.to)
                : undefined;

            if (
                from &&
                to &&
                from.getTime() > to.getTime()
            ) {
                throw new BadRequestException(
                    'From date cannot be after to date.',
                );
            }

            where.createdAt = {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
            };
        }

        const [data, total] = await Promise.all([
            this.prisma.call.findMany({
                where,
                orderBy: {
                    createdAt: 'desc',
                },
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    vapiCallId: true,
                    status: true,
                    outcome: true,
                    callType: true,
                    customerNumber: true,
                    startedAt: true,
                    endedAt: true,
                    durationSeconds: true,
                    endedReason: true,
                    createdAt: true,
                },
            }),

            this.prisma.call.count({ where }),
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

    // GET CALL DETAILS
    async findOne(id: string) {
        if (!/^[a-fA-F0-9]{24}$/.test(id)) {
            throw new BadRequestException(
                'Invalid call ID.',
            );
        }

        const call = await this.prisma.call.findUnique({
            where: { id },
        });

        if (!call) {
            throw new NotFoundException(
                'Call not found.',
            );
        }

        return call;
    }

    // CALL ANALYTICS
    async getOverview() {
        const [
            totalCalls,
            completedCalls,
            failedCalls,
            noAnswerCalls,
            inProgressCalls,
            durationStats,
            outcomeStats,
        ] = await Promise.all([
            this.prisma.call.count(),

            this.prisma.call.count({
                where: { status: 'COMPLETED' },
            }),

            this.prisma.call.count({
                where: { status: 'FAILED' },
            }),

            this.prisma.call.count({
                where: { status: 'NO_ANSWER' },
            }),

            this.prisma.call.count({
                where: { status: 'IN_PROGRESS' },
            }),

            this.prisma.call.aggregate({
                where: {
                    durationSeconds: {
                        not: null,
                    },
                },
                _avg: {
                    durationSeconds: true,
                },
            }),

            this.prisma.call.groupBy({
                by: ['outcome'],
                _count: {
                    _all: true,
                },
            }),
        ]);

        return {
            totalCalls,
            completedCalls,
            failedCalls,
            noAnswerCalls,
            inProgressCalls,
            averageDurationSeconds:
                Math.round(
                    durationStats._avg.durationSeconds ?? 0,
                ),
            outcomes: outcomeStats.map((item) => ({
                outcome: item.outcome,
                count: item._count._all,
            })),
        };
    }
}
