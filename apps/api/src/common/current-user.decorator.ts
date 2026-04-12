/**
 * @fileoverview 当前用户参数装饰器
 * @module api/common
 *
 * 自定义 NestJS 参数装饰器，从经过 AuthGuard 验证的请求中提取当前用户对象。
 */

import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/** 从请求上下文中提取经认证的用户对象 */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest();
  return request.user;
});
