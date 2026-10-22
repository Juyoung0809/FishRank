import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';

/** 로그인 필수 (JWT) */
export const Auth = () =>
  applyDecorators(UseGuards(JwtAuthGuard), ApiBearerAuth());

/** 관리자 전용 (JWT + role=admin) */
export const AdminAuth = () =>
  applyDecorators(UseGuards(JwtAuthGuard, AdminGuard), ApiBearerAuth());
