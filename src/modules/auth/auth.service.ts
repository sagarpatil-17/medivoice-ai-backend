import {
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { comparePassword } from '../../common/utils/password.util.js';
import { PrismaService } from '../../database/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtPayload } from './types/jwt-payload.type.js';

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

        const refreshTokenHash = this.hashRefreshToken(rawRefreshToken);

        const existingSession = await this.prisma.userSession.findUnique({
            where: { refreshTokenHash },
            include: { user: true },
        });

        if (!existingSession) {
            throw new UnauthorizedException('Invalid refresh token');
        }

        // Detect reuse of an already-revoked refresh token.
        if (existingSession.revokedAt) {
            await this.prisma.userSession.updateMany({
                where: {
                    userId: existingSession.userId,
                    revokedAt: null,
                },
                data: {
                    revokedAt: new Date(),
                },
            });

            throw new UnauthorizedException('Refresh token reuse detected');
        }

        if (
            existingSession.expiresAt <= new Date() ||
            !existingSession.user.isActive
        ) {
            throw new UnauthorizedException(
                'Refresh token expired or account inactive',
            );
        }

        const newRefreshToken = this.generateRefreshToken();
        const newRefreshTokenHash = this.hashRefreshToken(newRefreshToken);
        const now = new Date();

        const newExpiresAt = new Date(
            now.getTime() + REFRESH_COOKIE_TTL_DAYS * 24 * 60 * 60 * 1000,
        );

        try {
            await this.prisma.$transaction(async (tx) => {
                // Atomically claim the old refresh token.
                const claimed = await tx.userSession.updateMany({
                    where: {
                        id: existingSession.id,
                        revokedAt: null,
                        expiresAt: { gt: now },
                    },
                    data: {
                        revokedAt: now,
                        lastUsedAt: now,
                    },
                });

                if (claimed.count !== 1) {
                    throw new RotationConflictError();
                }

                // Create replacement refresh-token session.
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

                // Maintain the token rotation history.
                await tx.userSession.update({
                    where: { id: existingSession.id },
                    data: {
                        replacedById: replacement.id,
                    },
                });
            });
        } catch (error) {
            if (error instanceof RotationConflictError) {
                // Another request already rotated this token.
                // Revoke all active sessions for this user.
                await this.prisma.userSession.updateMany({
                    where: {
                        userId: existingSession.userId,
                        revokedAt: null,
                    },
                    data: {
                        revokedAt: new Date(),
                    },
                });

                throw new UnauthorizedException('Refresh token reuse detected');
            }

            throw error;
        }

        const payload: JwtPayload = {
            sub: existingSession.user.id,
            email: existingSession.user.email,
            role: existingSession.user.role,
        };

        const accessToken = await this.generateAccessToken(payload);

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
}