import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { SignupDto } from './dto/signup.dto.js';
import { ApiTags } from '@nestjs/swagger';

interface AuthenticatedRequest extends Request {
    user: {
        id: string;
        name: string;
        email: string;
        role: string;
    };
}

@ApiTags('AuthController')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    private getCookieOptions() {
        const isProduction = process.env.NODE_ENV === 'production';

        return {
            httpOnly: true,
            secure: isProduction,
            sameSite: (isProduction ? 'none' : 'lax') as 'none' | 'lax',
            path: '/api/auth',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        };
    }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(
        @Body() dto: LoginDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const result = await this.authService.login(
            dto,
            req.get('user-agent'),
            req.ip,
        );

        res.cookie(
            'refresh_token',
            result.refreshToken,
            this.getCookieOptions(),
        );

        return {
            accessToken: result.accessToken,
            user: result.user,
        };
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    async refresh(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const refreshToken = req.cookies?.refresh_token;

        const result = await this.authService.refresh(
            refreshToken,
            req.get('user-agent'),
            req.ip,
        );

        res.cookie(
            'refresh_token',
            result.refreshToken,
            this.getCookieOptions(),
        );

        return {
            accessToken: result.accessToken,
        };
    }

    @Post('logout')
    @HttpCode(HttpStatus.OK)
    async logout(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        await this.authService.logout(req.cookies?.refresh_token);

        res.clearCookie('refresh_token', {
            ...this.getCookieOptions(),
            maxAge: undefined,
        });

        return { message: 'Logged out successfully' };
    }

    @Post('logout-all')
    @UseGuards(AccessTokenGuard)
    @HttpCode(HttpStatus.OK)
    async logoutAll(@CurrentUser() user: AuthenticatedRequest['user']) {
        return this.authService.logoutAll(user.id);
    }

    @Get('me')
    @UseGuards(AccessTokenGuard)
    getProfile(@CurrentUser() user: AuthenticatedRequest['user']) {
        return user;
    }

    @Post('signup')
    @UseGuards(AccessTokenGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    async signup(@Body() dto: SignupDto) {
        return this.authService.signup(dto);
    }
}