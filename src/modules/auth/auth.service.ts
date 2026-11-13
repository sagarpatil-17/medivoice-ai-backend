import {
    BadRequestException,
    ConflictException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { comparePassword, hashPassword } from '../../common/utils/password.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtPayload } from './types/jwt-payload.type.js';
import { Prisma } from '@prisma/client';
import { SignupDto } from './dto/signup.dto.js';

const REFRESH_COOKIE_TTL_DAYS = 7;

class RotationConflictError extends Error { }

@Injectable()
export class AuthService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
    ) { }

    private hashRefreshToken(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }

    private generateRefreshToken(): string {
        return randomBytes(64).toString('hex');
    }

    private async generateAccessToken(payload: JwtPayload): Promise<string> {
        return this.jwtService.signAsync(payload, {
            secret: this.configService.getOrThrow<string>('JWT_SECRET'),
            expiresIn: '15m',
        });
    }

    private async createSession(
        userId: string,
        userAgent?: string,
        ipAddress?: string,
    ) {
        const refreshToken = this.generateRefreshToken();
        const refreshTokenHash = this.hashRefreshToken(refreshToken);

        const expiresAt = new Date(
            Date.now() + REFRESH_COOKIE_TTL_DAYS * 24 * 60 * 60 * 1000,
        );

        const session = await this.prisma.userSession.create({
            data: {
                userId,
                refreshTokenHash,
                expiresAt,
                userAgent,
                ipAddress,
                lastUsedAt: new Date(),
            },
        });

        return { refreshToken, session };
    }

    async login(
        dto: LoginDto,
        userAgent?: string,
        ipAddress?: string,
    ) {
        if (Buffer.byteLength(dto.password, 'utf8') > 72) {
            throw new UnauthorizedException('Invalid email or password');
        }

        const email = dto.email.trim().toLowerCase();

        const user = await this.prisma.user.findUnique({
            where: { email },
        });

        if (!user || !user.isActive) {
            throw new UnauthorizedException('Invalid email or password');
        }

        const passwordValid = await comparePassword(
            dto.password,
            user.passwordHash,
        );

        if (!passwordValid) {
            throw new UnauthorizedException('Invalid email or password');
        }

        const { refreshToken } = await this.createSession(
            user.id,
            userAgent,
            ipAddress,
        );

        const payload: JwtPayload = {
            sub: user.id,
            email: user.email,
            role: user.role,
        };

        const accessToken = await this.generateAccessToken(payload);

        return {
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        };
    }

    async refresh(
        rawRefreshToken: string,
        userAgent?: string,
        ipAddress?: string,
    ) {
        if (!rawRefreshToken) {
            throw new UnauthorizedException('Refresh token missing');
        }

        // 1. Hash incoming refresh token
        const refreshTokenHash = this.hashRefreshToken(rawRefreshToken);

        // 2. Find existing session
        const existingSession = await this.prisma.userSession.findUnique({
            where: { refreshTokenHash },
            include: { user: true },
        });

        if (!existingSession) {
            throw new UnauthorizedException('Invalid refresh token');
        }

        const now = new Date();

        // 3. Detect refresh-token reuse
        if (existingSession.revokedAt) {
            await this.prisma.userSession.updateMany({
                where: {
                    userId: existingSession.userId,
                    OR: [
                        { revokedAt: null },
                        { revokedAt: { isSet: false } },
                    ],
                },
                data: {
                    revokedAt: now,
                },
            });

            throw new UnauthorizedException('Refresh token reuse detected');
        }

        // 4. Check expiry and account status
        if (
            existingSession.expiresAt <= now ||
            !existingSession.user.isActive
        ) {
            throw new UnauthorizedException(
                'Refresh token expired or account inactive',
            );
        }

        // 5. Generate replacement refresh token
        const newRefreshToken = this.generateRefreshToken();
        const newRefreshTokenHash = this.hashRefreshToken(newRefreshToken);

        const newExpiresAt = new Date(
            now.getTime() +
            REFRESH_COOKIE_TTL_DAYS * 24 * 60 * 60 * 1000,
        );

        try {
            // 6. Atomically revoke old session and create replacement
            await this.prisma.$transaction(async (tx) => {
                const claimed = await tx.userSession.updateMany({
                    where: {
                        id: existingSession.id,
                        expiresAt: { gt: now },
                        OR: [
                            { revokedAt: null },
                            { revokedAt: { isSet: false } },
                        ],
                    },
                    data: {
                        revokedAt: now,
                        lastUsedAt: now,
                    },
                });

                // Another request may already have rotated this token
                if (claimed.count !== 1) {
                    throw new RotationConflictError();
                }

                // Create new refresh-token session
                const replacement = await tx.userSession.create({
                    data: {
                        userId: existingSession.userId,
                        refreshTokenHash: newRefreshTokenHash,
                        expiresAt: newExpiresAt,
                        userAgent,
                        ipAddress,
                        lastUsedAt: now,
                    },
                });

                // Link old session to replacement session
                await tx.userSession.update({
                    where: { id: existingSession.id },
                    data: {
                        replacedById: replacement.id,
                    },
                });
            });
        } catch (error) {
            if (error instanceof RotationConflictError) {
                // Revoke all remaining active sessions for this user
                await this.prisma.userSession.updateMany({
                    where: {
                        userId: existingSession.userId,
                        OR: [
                            { revokedAt: null },
                            { revokedAt: { isSet: false } },
                        ],
                    },
                    data: {
                        revokedAt: new Date(),
                    },
                });

                throw new UnauthorizedException('Refresh token reuse detected');
            }

            throw error;
        }

        // 7. Generate new access token
        const payload: JwtPayload = {
            sub: existingSession.user.id,
            email: existingSession.user.email,
            role: existingSession.user.role,
        };

        const accessToken = await this.generateAccessToken(payload);

        // 8. Return new tokens
        return {
            accessToken,
            refreshToken: newRefreshToken,
        };
    }

    async logout(rawRefreshToken?: string) {
        if (rawRefreshToken) {
            await this.prisma.userSession.updateMany({
                where: {
                    refreshTokenHash: this.hashRefreshToken(rawRefreshToken),
                    revokedAt: null,
                },
                data: { revokedAt: new Date() },
            });
        }

        return { message: 'Logged out successfully' };
    }

    async logoutAll(userId: string) {
        await this.prisma.userSession.updateMany({
            where: {
                userId,
                revokedAt: null,
            },
            data: { revokedAt: new Date() },
        });

        return { message: 'All sessions revoked successfully' };
    }

    async signup(dto: SignupDto) {
        const email = dto.email.trim().toLowerCase();

        // Do not allow admin creation through this endpoint.
        if (dto.role === 'ADMIN') {
            throw new BadRequestException(
                'Admin accounts must be created through a secure provisioning process',
            );
        }

        // bcrypt supports a maximum of 72 password bytes.
        if (Buffer.byteLength(dto.password, 'utf8') > 72) {
            throw new BadRequestException(
                'Password must not exceed 72 bytes',
            );
        }

        const existingUser = await this.prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            throw new ConflictException('Email is already registered');
        }

        const passwordHash = await hashPassword(dto.password);

        try {
            const user = await this.prisma.user.create({
                data: {
                    name: dto.name.trim(),
                    email,
                    passwordHash,
                    role: dto.role,
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    isActive: true,
                    createdAt: true,
                },
            });

            return {
                message: 'Staff account created successfully',
                user,
            };
        } catch (error) {
            // Handle duplicate email even if two requests arrive simultaneously.
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                throw new ConflictException('Email is already registered');
            }

            throw error;
        }
    }
}