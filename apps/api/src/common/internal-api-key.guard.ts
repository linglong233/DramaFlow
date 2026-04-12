/**
 * @fileoverview 内部 API 密钥守卫
 * @module api/common
 *
 * 用于保护 Worker 轮询的内部接口，通过 x-internal-key 请求头验证身份。
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

/** Worker 内部调用的 API 密钥验证守卫 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly expectedKey =
    process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key";

  /** 验证请求中的内部 API 密钥 */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided =
      request.headers["x-internal-key"] ??
      request.headers["authorization"]?.replace("Bearer ", "");

    if (!provided || provided !== this.expectedKey) {
      throw new UnauthorizedException("Invalid internal API key");
    }

    return true;
  }
}
