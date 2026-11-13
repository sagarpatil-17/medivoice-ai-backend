
import {
    BadRequestException,
    ConflictException,
    HttpException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { PrismaService } from '../../database/prisma.service.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { DoctorKnowledgeService } from '../doctor-knowledge/doctor-knowledge.service.js';
import { PatientsService } from '../patients/patients.service.js';

import { RegisterPatientDto } from './dto/register-patient.dto.js';

import {
    VapiWebhookBody,
    VapiServerMessage,
    VapiToolCall,
    VapiToolResult,
    VapiToolResponse,
} from './types/vapi-webhook.type.js';

import {
    generateCancellationToken,
    hashCancellationToken,
} from './utils/cancellation-token.util.js';

type InternalCallStatus =
    | 'QUEUED'
    | 'RINGING'
    | 'IN_PROGRESS'
    | 'TRANSFERRING'
    | 'COMPLETED'
    | 'FAILED'
    | 'NO_ANSWER';

@Injectable()
export class VapiService {
    private readonly logger = new Logger(VapiService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly appointmentsService: AppointmentsService,
        private readonly doctorKnowledgeService: DoctorKnowledgeService,
        private readonly patientsService: PatientsService,
    ) { }

    // --------------------------------------------------
    // HANDLE VAPI WEBHOOK
    // --------------------------------------------------

    async handleWebhook(
        body: VapiWebhookBody,
    ): Promise<VapiToolResponse> {
        const message = body?.message;

        if (!message || typeof message.type !== 'string') {
            throw new BadRequestException(
                'Invalid Vapi webhook payload.',
            );
        }

        this.logger.log(
            `[VAPI WEBHOOK RECEIVED] Type: ${message.type}`,
        );

        // Save call lifecycle information.
        if (
            message.type === 'status-update' ||
            message.type === 'end-of-call-report'
        ) {
            await this.saveCallEvent(message);
        }

        // Only tool-calls events require tool results.
        if (message.type !== 'tool-calls') {
            return { results: [] };
        }

        const callId = message.call?.id;

        if (!callId) {
            throw new BadRequestException(
                'Missing Vapi call ID.',
            );
        }

        const customerNumber =
            this.getStringValue(message.phoneNumber) ??
            this.getStringValue(message.call?.customer?.number);

        const callStartedAt = this.parseDate(
            message.call?.startedAt,
        );

        // Ensure the call exists before executing tools.
        await this.prisma.call.upsert({
            where: {
                vapiCallId: callId,
            },
            create: {
                vapiCallId: callId,
                status: 'IN_PROGRESS',
                vapiStatus: 'in-progress',
                ...(message.call?.type
                    ? { callType: message.call.type }
                    : {}),
                ...(customerNumber ? { customerNumber } : {}),
                startedAt: callStartedAt ?? new Date(),
            },
            update: {
                ...(customerNumber ? { customerNumber } : {}),
                ...(message.call?.type
                    ? { callType: message.call.type }
                    : {}),
                ...(callStartedAt ? { startedAt: callStartedAt } : {}),
            },
        });

        const toolCallList = message.toolCallList ?? [];

        const results = await Promise.all(
            toolCallList.map((toolCall) =>
                this.executeToolSafely(toolCall, callId),
            ),
        );

        return { results };
    }

    // --------------------------------------------------
    // SAFE TOOL EXECUTION
    // --------------------------------------------------

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

            // Analytics must never turn a successful tool into a failure.
            await this.recordToolOutcome(
                callId,
                toolName,
                result,
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

    // --------------------------------------------------
    // PARSE TOOL ARGUMENTS
    // --------------------------------------------------

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

    // --------------------------------------------------
    // TOOL DISPATCHER
    // --------------------------------------------------

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

            case 'find_appointment_for_cancellation':
                return this.findAppointmentForCancellation(
                    args,
                    callId,
                );

            case 'cancel_appointment':
                return this.cancelAppointment(args, callId);

            default:
                throw new BadRequestException(
                    `Unknown Vapi tool: ${name}`,
                );
        }
    }

    // --------------------------------------------------
    // FIND DOCTORS USING RAG
    // --------------------------------------------------

    private async findDoctors(
        args: Record<string, unknown>,
    ) {
        const query = this.getRequiredString(
            args,
            'query',
            300,
        );

        this.logger.log('[RAG SEARCH] Doctor search started.');

        const result =
            await this.doctorKnowledgeService.findDoctorsByQuery(
                query,
            );

        this.logger.log(
            `[RAG SEARCH COMPLETED] Matched: ${result.matched}`,
        );

        return result;
    }

    // --------------------------------------------------
    // CHECK APPOINTMENT AVAILABILITY
    // --------------------------------------------------

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

        return this.appointmentsService.checkAvailability({
            doctorId,
            date,
        });
    }

    // --------------------------------------------------
    // REGISTER PATIENT THROUGH VOICE
    // --------------------------------------------------

    private async registerPatient(
        args: Record<string, unknown>,
        callId: string,
    ) {
        const existingSession =
            await this.prisma.voiceBookingSession.findUnique({
                where: { callId },
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

        const registration =
            await this.patientsService.registerFromVoice(dto);

        if (
            !registration.registered ||
            !registration.patient
        ) {
            return registration;
        }

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

    // --------------------------------------------------
    // BOOK APPOINTMENT
    // --------------------------------------------------

    private async bookAppointment(
        args: Record<string, unknown>,
        callId: string,
    ) {
        const doctorId = this.getRequiredString(
            args,
            'doctorId',
            24,
        );

        const startAt = this.getRequiredString(
            args,
            'startAt',
            40,
        );

        if (!/^[a-fA-F0-9]{24}$/.test(doctorId)) {
            throw new BadRequestException(
                'Invalid doctor ID.',
            );
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

        const session =
            await this.prisma.voiceBookingSession.findUnique({
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
                message:
                    'An appointment has already been booked during this call.',
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

        const claim =
            await this.prisma.voiceBookingSession.updateMany({
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
            const appointment =
                await this.appointmentsService.createFromVoice({
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
                bookingReference: appointment.bookingReference,
                doctor: appointment.doctor?.fullName,
                specialization:
                    appointment.doctor?.specialization,
                startAt: appointment.startAt.toISOString(),
                endAt: appointment.endAt.toISOString(),
                message: 'Appointment successfully booked.',
            };
        } catch (error) {
            const existingAppointment =
                await this.prisma.appointment.findUnique({
                    where: {
                        idempotencyKey: `vapi:${callId}`,
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
                    bookingReference:
                        existingAppointment.bookingReference,
                    doctor: existingAppointment.doctor.fullName,
                    specialization:
                        existingAppointment.doctor.specialization,
                    startAt:
                        existingAppointment.startAt.toISOString(),
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

    // --------------------------------------------------
    // FIND APPOINTMENT FOR CANCELLATION
    // --------------------------------------------------

    private async findAppointmentForCancellation(
        args: Record<string, unknown>,
        callId: string,
    ) {
        const bookingReference = this.getRequiredString(
            args,
            'bookingReference',
            14,
        ).toUpperCase();

        const phone = this.getRequiredString(
            args,
            'phone',
            16,
        );

        if (!/^MED-[A-F0-9]{10}$/.test(bookingReference)) {
            throw new BadRequestException(
                'Invalid booking reference.',
            );
        }

        if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
            throw new BadRequestException(
                'Invalid phone number.',
            );
        }

        const appointment =
            await this.prisma.appointment.findFirst({
                where: {
                    bookingReference,
                    patient: {
                        is: { phone },
                    },
                    status: {
                        in: ['PENDING', 'CONFIRMED'],
                    },
                    startAt: {
                        gt: new Date(),
                    },
                },
                select: {
                    id: true,
                    patientId: true,
                    bookingReference: true,
                    startAt: true,
                    endAt: true,
                    status: true,
                    doctor: {
                        select: {
                            fullName: true,
                            specialization: true,
                        },
                    },
                },
            });

        if (!appointment) {
            throw new NotFoundException(
                'Unable to verify this appointment. Please check your booking reference and registered mobile number, or contact reception.',
            );
        }

        const token = generateCancellationToken();
        const tokenHash = hashCancellationToken(token);

        const expiresAt = new Date(
            Date.now() + 5 * 60 * 1000,
        );

        await this.prisma.voiceCancellationSession.upsert({
            where: { callId },
            create: {
                callId,
                appointmentId: appointment.id,
                patientId: appointment.patientId,
                tokenHash,
                expiresAt,
            },
            update: {
                appointmentId: appointment.id,
                patientId: appointment.patientId,
                tokenHash,
                status: 'ACTIVE',
                expiresAt,
            },
        });

        return {
            verified: true,
            cancellationToken: token,
            doctor: appointment.doctor.fullName,
            specialization:
                appointment.doctor.specialization,
            startAt: appointment.startAt.toISOString(),
            endAt: appointment.endAt.toISOString(),
            status: appointment.status,
            message:
                'Appointment verified. Read the appointment details to the patient and ask for explicit confirmation before cancelling.',
        };
    }

    // --------------------------------------------------
    // CANCEL APPOINTMENT
    // --------------------------------------------------

    private async cancelAppointment(
        args: Record<string, unknown>,
        callId: string,
    ) {
        const token = this.getRequiredString(
            args,
            'cancellationToken',
            64,
        );

        if (!/^[a-f0-9]{64}$/i.test(token)) {
            throw new BadRequestException(
                'Invalid cancellation request.',
            );
        }

        if (args.patientConfirmed !== true) {
            throw new BadRequestException(
                'Explicit patient confirmation is required.',
            );
        }

        const cancellationReason =
            typeof args.cancellationReason === 'string'
                ? args.cancellationReason.trim().slice(0, 300)
                : undefined;

        const tokenHash = hashCancellationToken(token);
        const now = new Date();

        const result = await this.prisma.$transaction(
            async (tx) => {
                const session =
                    await tx.voiceCancellationSession.findUnique({
                        where: { tokenHash },
                    });

                if (
                    !session ||
                    session.callId !== callId ||
                    session.status !== 'ACTIVE' ||
                    session.expiresAt <= now
                ) {
                    throw new BadRequestException(
                        'Cancellation verification has expired. Please verify your appointment again.',
                    );
                }

                const update = await tx.appointment.updateMany({
                    where: {
                        id: session.appointmentId,
                        patientId: session.patientId,
                        status: {
                            in: ['PENDING', 'CONFIRMED'],
                        },
                        startAt: {
                            gt: now,
                        },
                    },
                    data: {
                        status: 'CANCELLED',
                        cancelledAt: now,
                        ...(cancellationReason
                            ? { cancellationReason }
                            : {}),
                    },
                });

                if (update.count !== 1) {
                    throw new ConflictException(
                        'This appointment can no longer be cancelled. Please contact reception.',
                    );
                }

                await tx.voiceCancellationSession.update({
                    where: { id: session.id },
                    data: {
                        status: 'CANCELLED',
                    },
                });

                return tx.appointment.findUnique({
                    where: {
                        id: session.appointmentId,
                    },
                    select: {
                        id: true,
                        bookingReference: true,
                        startAt: true,
                        status: true,
                        doctor: {
                            select: {
                                fullName: true,
                                specialization: true,
                            },
                        },
                    },
                });
            },
        );

        if (!result) {
            throw new ConflictException(
                'Unable to complete cancellation.',
            );
        }

        return {
            cancelled: true,
            appointmentId: result.id,
            bookingReference: result.bookingReference,
            doctor: result.doctor.fullName,
            specialization:
                result.doctor.specialization,
            startAt: result.startAt.toISOString(),
            message:
                'Your appointment has been successfully cancelled.',
        };
    }

    // --------------------------------------------------
    // RECORD TOOL OUTCOME
    // --------------------------------------------------

    private async recordToolOutcome(
        callId: string,
        toolName: string,
        result: unknown,
    ): Promise<void> {
        if (
            !result ||
            typeof result !== 'object' ||
            Array.isArray(result)
        ) {
            return;
        }

        const data = result as Record<string, unknown>;

        let outcome:
            | 'APPOINTMENT_BOOKED'
            | 'APPOINTMENT_CANCELLED'
            | undefined;

        if (
            toolName === 'book_appointment' &&
            data['booked'] === true
        ) {
            outcome = 'APPOINTMENT_BOOKED';
        }

        if (
            toolName === 'cancel_appointment' &&
            data['cancelled'] === true
        ) {
            outcome = 'APPOINTMENT_CANCELLED';
        }

        if (!outcome) {
            return;
        }

        try {
            await this.prisma.call.update({
                where: {
                    vapiCallId: callId,
                },
                data: {
                    outcome,
                    ...(typeof data['appointmentId'] === 'string'
                        ? { appointmentId: data['appointmentId'] }
                        : {}),
                },
            });
        } catch (error) {
            // Do not fail the actual appointment operation
            // because an analytics update failed.
            this.logger.error(
                `[CALL OUTCOME UPDATE FAILED] ${callId}`,
                error instanceof Error
                    ? error.stack
                    : String(error),
            );
        }
    }

    // --------------------------------------------------
    // SAVE CALL LIFECYCLE EVENTS
    // --------------------------------------------------

    private async saveCallEvent(
        message: VapiServerMessage,
    ): Promise<void> {
        const callId = message.call?.id;

        if (!callId) {
            this.logger.warn(
                'Received Vapi call event without call ID.',
            );
            return;
        }

        const startedAt =
            this.parseDate(message.startedAt) ??
            this.parseDate(message.call?.startedAt);

        const endedAt =
            this.parseDate(message.endedAt) ??
            this.parseDate(message.call?.endedAt);

        const durationSeconds =
            startedAt && endedAt
                ? Math.max(
                    0,
                    Math.floor(
                        (endedAt.getTime() -
                            startedAt.getTime()) /
                        1000,
                    ),
                )
                : undefined;

        const customerNumber =
            this.getStringValue(message.phoneNumber) ??
            this.getStringValue(
                message.call?.customer?.number,
            );

        const transcript =
            this.getStringValue(
                message.artifact?.transcript,
            ) ??
            this.getStringValue(message.transcript);

        const summary =
            this.getStringValue(message.summary) ??
            this.getStringValue(
                message.analysis?.summary,
            );

        const recordingUrl =
            this.getRecordingUrl(message);

        const endedReason =
            this.getStringValue(message.endedReason) ??
            this.getStringValue(
                message.call?.endedReason,
            );

        let status: InternalCallStatus | undefined;

        if (message.type === 'status-update') {
            const statusMap: Record<
                string,
                InternalCallStatus
            > = {
                scheduled: 'QUEUED',
                queued: 'QUEUED',
                ringing: 'RINGING',
                'in-progress': 'IN_PROGRESS',
                forwarding: 'TRANSFERRING',
                ended: 'COMPLETED',
            };

            status = statusMap[message.status ?? ''];
        }

        if (message.type === 'end-of-call-report') {
            const reason = (endedReason ?? '').toLowerCase();

            if (
                reason.includes('no-answer') ||
                reason.includes('no_answer') ||
                reason.includes('did-not-answer')
            ) {
                status = 'NO_ANSWER';
            } else if (
                reason.includes('error') ||
                reason.includes('failed')
            ) {
                status = 'FAILED';
            } else {
                status = 'COMPLETED';
            }
        }

        const updateData = {
            ...(message.status
                ? { vapiStatus: message.status }
                : {}),
            ...(status ? { status } : {}),
            ...(message.call?.type
                ? { callType: message.call.type }
                : {}),
            ...(customerNumber
                ? { customerNumber }
                : {}),
            ...(startedAt ? { startedAt } : {}),
            ...(endedAt ? { endedAt } : {}),
            ...(durationSeconds !== undefined
                ? { durationSeconds }
                : {}),
            ...(endedReason
                ? { endedReason }
                : {}),
            ...(transcript
                ? { transcript }
                : {}),
            ...(summary
                ? { summary }
                : {}),
            ...(recordingUrl
                ? { recordingUrl }
                : {}),
        };

        await this.prisma.call.upsert({
            where: {
                vapiCallId: callId,
            },
            create: {
                vapiCallId: callId,
                status: status ?? 'QUEUED',
                startedAt: startedAt ?? new Date(),
                ...updateData,
            },
            update: updateData,
        });

        this.logger.log(
            `[CALL EVENT SAVED] ${callId} - ${message.type}`,
        );
    }

    // --------------------------------------------------
    // RECORDING URL
    // --------------------------------------------------

    private getRecordingUrl(
        message: VapiServerMessage,
    ): string | undefined {
        const recording = message.artifact?.recording;

        if (
            recording &&
            typeof recording === 'object'
        ) {
            const url =
                this.getStringValue(recording.url) ??
                this.getStringValue(recording.mono) ??
                this.getStringValue(recording.stereo);

            if (url) {
                return url;
            }
        }

        if (typeof recording === 'string') {
            const value = this.getStringValue(recording);

            if (value) {
                return value;
            }
        }

        return (
            this.getStringValue(
                message.artifact?.recordingUrl,
            ) ??
            this.getStringValue(
                message.artifact?.stereoRecordingUrl,
            ) ??
            this.getStringValue(message.recordingUrl) ??
            this.getStringValue(message.stereoRecordingUrl)
        );
    }

    // --------------------------------------------------
    // COMMON HELPERS
    // --------------------------------------------------

    private getStringValue(
        value: unknown,
    ): string | undefined {
        return typeof value === 'string' &&
            value.trim().length > 0
            ? value.trim()
            : undefined;
    }

    private parseDate(
        value?: string,
    ): Date | undefined {
        if (!value) {
            return undefined;
        }

        const date = new Date(value);

        return Number.isNaN(date.getTime())
            ? undefined
            : date;
    }

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

    // --------------------------------------------------
    // DATE VALIDATION
    // --------------------------------------------------

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

    // --------------------------------------------------
    // SAFE ERROR MESSAGES
    // --------------------------------------------------

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
