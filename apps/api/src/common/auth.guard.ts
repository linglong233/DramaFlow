/**
 * @fileoverview JWT Bearer 认证守卫
 * @module api/common
 *
 * 从请求头提取 Bearer Token，验证 JWT 并将用户对象挂载到 request.user。
 */

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

import { DevDatabaseService } from "./dev-database.service";

/** JWT Bearer 认证守卫，验证访问令牌并加载用户信息 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
  ) {}

  /** 验证请求中的 Bearer Token 并加载用户对象 */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const token = header.slice("Bearer ".length);

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? "dramaflow-access-secret",
      });

      const user = await this.database.query((db) =>
        db.users.find((item) => item.id === payload.sub),
      );

      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException("Invalid token");
    }
  }
}
