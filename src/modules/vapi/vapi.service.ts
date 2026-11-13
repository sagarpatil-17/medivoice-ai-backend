
import {
    BadRequestException,
    Injectable,
    Logger,
} from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';
import { AppointmentsService } from '../appointments/appointments.service.js';

import {
    VapiToolCall,
    VapiToolResult,
    VapiWebhookBody,
} from './types/vapi-webhook.type.js';
import { DoctorKnowledgeService } from '../doctor-knowledge/doctor-knowledge.service.js';

type FindDoctorsArgs = {
    specialization?: string;
    departmentName?: string;
};

type CheckAvailabilityArgs = {
    doctorId: string;
    date: string;
};

@Injectable()
export class VapiService {
    private readonly logger = new Logger(VapiService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly appointmentsService: AppointmentsService,
        private readonly doctorKnowledgeService: DoctorKnowledgeService,
    ) { }

    // -------------------------------------------------------
    // MAIN WEBHOOK HANDLER
    // -------------------------------------------------------

    async handleWebhook(body: VapiWebhookBody) {
        console.log('[VAPI WEBHOOK RECEIVED]', {
            type: body.message?.type,
            callId: body.message?.call?.id,
            toolNames: body.message?.toolCallList?.map(
                (tool) => tool.function.name,
            ),
            timestamp: new Date().toISOString(),
        });

        const message = body?.message;

        if (!message?.type) {
            return {
                results: [],
            };
        }

        // This endpoint is intended for Function tool calls.
        // Other call lifecycle events will be handled separately.
        if (message.type !== 'tool-calls') {
            return {
                results: [],
            };
        }

        const toolCalls = message.toolCallList ?? [];

        const results = await Promise.all(
            toolCalls.map((toolCall) =>
                this.executeToolSafely(toolCall),
            ),
        );

        return {
            results,
        };
    }

    // -------------------------------------------------------
    // TOOL EXECUTION
    // -------------------------------------------------------

    private async executeToolSafely(
        toolCall: VapiToolCall,
    ): Promise<VapiToolResult> {
        const toolCallId = toolCall?.id;
        const toolName = toolCall?.function?.name;

        if (!toolCallId || !toolName) {
            return {
                name: toolName ?? 'unknown',
                toolCallId: toolCallId ?? 'unknown',
                error: 'Invalid tool call.',
            };
        }

        try {
            const args = this.parseArguments(
                toolCall.function.arguments,
            );

            const result = await this.executeTool(
                toolName,
                args,
            );

            return {
                name: toolName,
                toolCallId,
                result: JSON.stringify(result),
            };
        } catch (error) {
            this.logger.error(
                `Vapi tool failed: ${toolName}`,
                error instanceof Error
                    ? error.stack
                    : String(error),
            );

            return {
                name: toolName,
                toolCallId,
                error: this.getSafeErrorMessage(error),
            };
        }
    }

    private parseArguments(
        argumentsValue: unknown,
    ): Record<string, unknown> {
        let parsed: unknown = argumentsValue;

        if (typeof argumentsValue === 'string') {
            try {
                parsed = JSON.parse(argumentsValue);
            } catch {
                throw new Error(
                    'Tool arguments must be valid JSON.',
                );
            }
        }

        if (
            !parsed ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed)
        ) {
            throw new Error(
                'Tool arguments must be a JSON object.',
            );
        }

        return parsed as Record<string, unknown>;
    }

    private async executeTool(
        name: string,
        args: Record<string, unknown>,
    ): Promise<unknown> {
        switch (name) {
            case 'find_doctors':
                return this.doctorKnowledgeService.findDoctorsByQuery(
                    this.getRequiredString(args, 'query'),
                );

            case 'check_availability':
                return this.checkAvailability(
                    args as CheckAvailabilityArgs,
                );

            default:
                throw new Error(
                    `Unsupported tool: ${name}`,
                );
        }
    }

    private getRequiredString(
        args: Record<string, unknown>,
        key: string,
    ): string {
        const value = args[key];

        if (
            typeof value !== 'string' ||
            value.trim().length < 2 ||
            value.trim().length > 300
        ) {
            throw new BadRequestException(
                `Invalid ${key} parameter.`,
            );
        }

        return value.trim();
    }

    private getSafeErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            // Do not expose database or internal server details.
            if (
                error.name === 'BadRequestException' ||
                error.name === 'NotFoundException' ||
                error.name === 'ConflictException'
            ) {
                return error.message;
            }
        }

        return 'The requested operation could not be completed. Please try again.';
    }

    // -------------------------------------------------------
    // TOOL 1: FIND DOCTORS
    // -------------------------------------------------------

    private async findDoctors(
        args: FindDoctorsArgs,
    ) {
        const specialization =
            this.validateOptionalText(
                args.specialization,
                'specialization',
            );

        const departmentName =
            this.validateOptionalText(
                args.departmentName,
                'departmentName',
            );

        const doctors =
            await this.prisma.doctor.findMany({
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

                            ...(departmentName && {
                                name: {
                                    contains: departmentName,
                                },
                            }),
                        },
                    },

                    ...(specialization && {
                        specialization: {
                            contains: specialization,
                        },
                    }),
                },

                select: {
                    id: true,
                    fullName: true,
                    specialization: true,
                    qualification: true,
                    experienceYears: true,
                    consultationFee: true,

                    department: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },

                orderBy: {
                    fullName: 'asc',
                },

                take: 10,
            });

        return {
            count: doctors.length,
            doctors: doctors.map((doctor) => ({
                id: doctor.id,
                name: doctor.fullName,
                specialization: doctor.specialization,
                qualification: doctor.qualification,
                experienceYears: doctor.experienceYears,
                consultationFee:
                    doctor.consultationFee / 100,
                currency: 'INR',
                department: doctor.department.name,
            })),
        };
    }

    // -------------------------------------------------------
    // TOOL 2: CHECK AVAILABILITY
    // -------------------------------------------------------

    private async checkAvailability(
        args: CheckAvailabilityArgs,
    ) {
        const doctorId = args.doctorId;
        const date = args.date;

        if (
            typeof doctorId !== 'string' ||
            !/^[a-fA-F0-9]{24}$/.test(doctorId)
        ) {
            throw new Error(
                'A valid doctor ID is required.',
            );
        }

        if (
            typeof date !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(date)
        ) {
            throw new Error(
                'Date must use YYYY-MM-DD format.',
            );
        }

        const availability =
            await this.appointmentsService.checkAvailability({
                doctorId,
                date,
            });

        return {
            doctor: {
                id: availability.doctor.id,
                name: availability.doctor.fullName,
                specialization:
                    availability.doctor.specialization,
                department:
                    availability.doctor.department.name,
            },

            date: availability.date,
            timezone: availability.timezone,

            availableCount:
                availability.availableCount,

            slots: availability.slots
                .filter((slot) => slot.available)
                .map((slot) => ({
                    startAt: slot.startAt,
                    endAt: slot.endAt,
                })),
        };
    }

    // -------------------------------------------------------
    // INPUT VALIDATION
    // -------------------------------------------------------

    private validateOptionalText(
        value: unknown,
        fieldName: string,
    ): string | undefined {
        if (value === undefined || value === null || value === '') {
            return undefined;
        }

        if (
            typeof value !== 'string' ||
            value.trim().length === 0 ||
            value.length > 100
        ) {
            throw new Error(
                `Invalid ${fieldName}.`,
            );
        }

        return value.trim();
    }
}
