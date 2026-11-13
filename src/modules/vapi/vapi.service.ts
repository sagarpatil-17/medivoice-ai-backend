
import {
    BadRequestException,
    HttpException,
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { DoctorKnowledgeService } from '../doctor-knowledge/doctor-knowledge.service.js';
import { PatientsService } from '../patients/patients.service.js';

import { RegisterPatientDto } from './dto/register-patient.dto.js';
import {
    VapiWebhookBody,
    VapiToolCall,
    VapiToolResult,
    VapiToolResponse,
} from './types/vapi-webhook.type.js';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

@Injectable()
export class VapiService {
    private readonly logger = new Logger(VapiService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly appointmentsService: AppointmentsService,
        private readonly doctorKnowledgeService: DoctorKnowledgeService,
        private readonly patientsService: PatientsService,
    ) { }

    // HANDLE VAPI WEBHOOK
    async handleWebhook(
        body: VapiWebhookBody,
    ): Promise<VapiToolResponse> {
        const message = body?.message;

        if (!message) {
            throw new BadRequestException(
                'Invalid Vapi webhook payload.',
            );
        }

        this.logger.log(
            `[VAPI WEBHOOK RECEIVED] Type: ${message.type}`,
        );

        // Handle only function tool calls here.
        if (message.type !== 'tool-calls') {
            return {
                results: [],
            };
        }

        const toolCallList = message.toolCallList ?? [];
        const callId = message.call?.id;

        if (!callId) {
            throw new BadRequestException(
                'Missing Vapi call ID.',
            );
        }

        this.logger.log(
            `[VAPI TOOL CALLS] Call ID: ${callId}, Tools: ${toolCallList
                .map((tool) => tool.function.name)
                .join(', ')}`,
        );

        const results = await Promise.all(
            toolCallList.map((toolCall) =>
                this.executeToolSafely(toolCall, callId),
            ),
        );

        return {
            results,
        };
    }

    // SAFE TOOL EXECUTION
    private async executeToolSafely(
        toolCall: VapiToolCall,
        callId: string,
    ): Promise<VapiToolResult> {
        const toolName = toolCall.function.name;

        try {
            const args = this.parseToolArguments(
                toolCall.function.arguments,
            );

            this.logger.log(
                `[VAPI TOOL STARTED] ${toolName}`,
            );

            const startTime = Date.now();

            const result = await this.executeTool(
                toolName,
                args,
                callId,
            );

            this.logger.log(
                `[VAPI TOOL COMPLETED] ${toolName} - ${Date.now() - startTime
                }ms`,
            );

            return {
                name: toolName,
                toolCallId: toolCall.id,
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
                toolCallId: toolCall.id,
                error: this.getSafeErrorMessage(error),
            };
        }
    }

    // PARSE TOOL ARGUMENTS
    private parseToolArguments(
        argumentsValue: unknown,
    ): Record<string, unknown> {
        let parsed = argumentsValue;

        if (typeof parsed === 'string') {
            try {
                parsed = JSON.parse(parsed);
            } catch {
                throw new BadRequestException(
                    'Invalid tool arguments JSON.',
                );
            }
        }

        if (
            !parsed ||
            typeof parsed !== 'object' ||
            Array.isArray(parsed)
        ) {
            throw new BadRequestException(
                'Tool arguments must be a valid object.',
            );
        }

        return parsed as Record<string, unknown>;
    }

    // TOOL DISPATCHER
    private async executeTool(
        name: string,
        args: Record<string, unknown>,
        callId: string,
    ): Promise<unknown> {
        switch (name) {
            case 'find_doctors':
                return this.findDoctors(args);

            case 'check_availability':
                return this.checkAvailability(args);

            case 'register_patient':
                return this.registerPatient(args, callId);

            case 'book_appointment':
                return this.bookAppointment(args, callId);

            default:
                throw new BadRequestException(
                    `Unknown Vapi tool: ${name}`,
                );
        }
    }

    // FIND DOCTORS USING RAG
    private async findDoctors(
        args: Record<string, unknown>,
    ) {
        const query = this.getRequiredString(
            args,
            'query',
            300,
        );

        this.logger.log(
            `[RAG SEARCH] Query: ${query}`,
        );

        const result =
            await this.doctorKnowledgeService.findDoctorsByQuery(
                query,
            );

        this.logger.log(
            `[RAG SEARCH COMPLETED] Matched: ${result.matched}`,
        );

        return result;
    }

    // CHECK APPOINTMENT AVAILABILITY
    private async checkAvailability(
        args: Record<string, unknown>,
    ) {
        const doctorId = this.getRequiredString(
            args,
            'doctorId',
            24,
        );

        const date = this.getRequiredString(
            args,
            'date',
            10,
        );

        if (!/^[a-fA-F0-9]{24}$/.test(doctorId)) {
            throw new BadRequestException(
                'Invalid doctor ID.',
            );
        }

        this.validateDate(date);

        this.logger.log(
            `[AVAILABILITY CHECK] Doctor: ${doctorId}, Date: ${date}`,
        );

        const availability =
            await this.appointmentsService.checkAvailability({
                doctorId,
                date,
            });

        return availability;
    }

    // REGISTER PATIENT THROUGH VOICE
    private async registerPatient(
        args: Record<string, unknown>,
        callId: string,
    ) {
        // Check whether this Vapi call already has a session.
        const existingSession =
            await this.prisma.voiceBookingSession.findUnique({
                where: {
                    callId,
                },
            });

        if (existingSession) {
            if (
                existingSession.status !== 'ACTIVE' ||
                existingSession.expiresAt <= new Date()
            ) {
                throw new BadRequestException(
                    'This booking session is no longer active.',
                );
            }

            return {
                registered: true,
                message:
                    'Patient is already registered for this call.',
                sessionExpiresAt:
                    existingSession.expiresAt.toISOString(),
            };
        }

        // Validate incoming patient information.
        const dto = plainToInstance(
            RegisterPatientDto,
            args,
        );

        const errors = await validate(dto, {
            whitelist: true,
            forbidNonWhitelisted: true,
        });

        if (errors.length > 0) {
            throw new BadRequestException(
                'Please provide a valid patient name and mobile number.',
            );
        }

        // Register a new patient.
        const registration =
            await this.patientsService.registerFromVoice(dto);

        // Existing matching patient.
        // Do not expose their patient ID or personal details.
        if (
            !registration.registered ||
            !registration.patient
        ) {
            return registration;
        }

        // Create a 30-minute voice booking session.
        const expiresAt = new Date(
            Date.now() + 30 * 60 * 1000,
        );

        const session =
            await this.prisma.voiceBookingSession.create({
                data: {
                    callId,
                    patientId: registration.patient.id,
                    expiresAt,
                },
            });

        this.logger.log(
            `[VOICE BOOKING SESSION CREATED] Call ID: ${callId}`,
        );

        return {
            registered: true,
            message:
                'Patient registered and booking session created.',
            sessionExpiresAt:
                session.expiresAt.toISOString(),
        };
    }

    // book appointment
    private async bookAppointment(
        args: Record<string, unknown>,
        callId: string,
    ) {
        const doctorId = this.getRequiredString(args, 'doctorId', 24);
        const startAt = this.getRequiredString(args, 'startAt', 40);

        if (!/^[a-fA-F0-9]{24}$/.test(doctorId)) {
            throw new BadRequestException('Invalid doctor ID.');
        }

        if (args.patientConfirmed !== true) {
            throw new BadRequestException(
                'Patient confirmation is required before booking.',
            );
        }

        const reason =
            typeof args.reason === 'string'
                ? args.reason.trim().slice(0, 300)
                : undefined;

        const session = await this.prisma.voiceBookingSession.findUnique({
            where: { callId },
        });

        if (!session) {
            throw new BadRequestException(
                'Please complete patient registration before booking.',
            );
        }

        if (session.status === 'BOOKED') {
            return {
                booked: true,
                message: 'An appointment has already been booked during this call.',
                appointmentId: session.appointmentId,
            };
        }

        if (
            session.status === 'EXPIRED' ||
            session.expiresAt <= new Date()
        ) {
            throw new BadRequestException(
                'Your booking session has expired. Please contact reception.',
            );
        }

        if (session.status === 'BOOKING') {
            throw new BadRequestException(
                'Your appointment booking is already being processed.',
            );
        }

        // Atomically claim the session so parallel calls cannot book twice.
        const claim = await this.prisma.voiceBookingSession.updateMany({
            where: {
                id: session.id,
                status: 'ACTIVE',
                expiresAt: { gt: new Date() },
            },
            data: {
                status: 'BOOKING',
            },
        });

        if (claim.count !== 1) {
            throw new BadRequestException(
                'Your booking request is already being processed. Please wait.',
            );
        }

        try {
            const appointment = await this.appointmentsService.createFromVoice({
                patientId: session.patientId,
                doctorId,
                startAt,
                idempotencyKey: `vapi:${callId}`,
                reason,
            });

            await this.prisma.voiceBookingSession.update({
                where: { id: session.id },
                data: {
                    status: 'BOOKED',
                    appointmentId: appointment.id,
                },
            });

            this.logger.log(
                `[VOICE APPOINTMENT BOOKED] Call ID: ${callId}`,
            );

            return {
                booked: true,
                appointmentId: appointment.id,
                doctor: appointment.doctor?.fullName,
                specialization: appointment.doctor?.specialization,
                startAt: appointment.startAt.toISOString(),
                endAt: appointment.endAt.toISOString(),
                message: 'Appointment successfully booked.',
            };
        } catch (error) {
            // Allow retry if booking failed before an appointment was committed.
            const existingAppointment =
                await this.prisma.appointment.findUnique({
                    where: { idempotencyKey: `vapi:${callId}` },
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

            if (existingAppointment) {
                await this.prisma.voiceBookingSession.update({
                    where: { id: session.id },
                    data: {
                        status: 'BOOKED',
                        appointmentId: existingAppointment.id,
                    },
                });

                return {
                    booked: true,
                    appointmentId: existingAppointment.id,
                    startAt: existingAppointment.startAt.toISOString(),
                    message: 'Appointment successfully booked.',
                };
            }

            await this.prisma.voiceBookingSession.updateMany({
                where: {
                    id: session.id,
                    status: 'BOOKING',
                },
                data: {
                    status: 'ACTIVE',
                },
            });

            throw error;
        }
    }

    // REQUIRED STRING VALIDATION
    private getRequiredString(
        args: Record<string, unknown>,
        key: string,
        maxLength = 300,
    ): string {
        const value = args[key];

        if (
            typeof value !== 'string' ||
            value.trim().length < 2 ||
            value.trim().length > maxLength
        ) {
            throw new BadRequestException(
                `Invalid ${key} parameter.`,
            );
        }

        return value.trim();
    }

    // DATE VALIDATION
    private validateDate(date: string): void {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new BadRequestException(
                'Date must use YYYY-MM-DD format.',
            );
        }

        const [year, month, day] = date
            .split('-')
            .map(Number);

        const parsedDate = new Date(
            Date.UTC(year, month - 1, day),
        );

        if (
            parsedDate.getUTCFullYear() !== year ||
            parsedDate.getUTCMonth() !== month - 1 ||
            parsedDate.getUTCDate() !== day
        ) {
            throw new BadRequestException(
                'Invalid calendar date.',
            );
        }
    }

    // SAFE ERROR MESSAGES
    private getSafeErrorMessage(
        error: unknown,
    ): string {
        if (error instanceof HttpException) {
            if (error.getStatus() < 500) {
                const response = error.getResponse();

                if (typeof response === 'string') {
                    return response;
                }

                if (
                    typeof response === 'object' &&
                    response !== null &&
                    'message' in response
                ) {
                    const message = response.message;

                    if (typeof message === 'string') {
                        return message;
                    }

                    if (
                        Array.isArray(message) &&
                        message.every(
                            (item) => typeof item === 'string',
                        )
                    ) {
                        return message.join(', ');
                    }
                }

                return error.message;
            }
        }

        return 'Sorry, the requested operation is temporarily unavailable. Please try again.';
    }
}
