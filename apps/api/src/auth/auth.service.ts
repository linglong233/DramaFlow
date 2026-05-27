/**
 * @fileoverview 认证服务
 * @module api/auth
 *
 * 实现用户注册、登录、令牌管理、密码重置和个人信息管理。
 * 使用 argon2 进行密码哈希，JWT 进行会话管理。
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import argon2 from "argon2";

import type { ImageGenerationConfig, LlmModelListResponse, LlmProviderConfig, UserRecord } from "@dramaflow/shared";

import { PrismaService } from "../common/prisma.service";
import { jsonOutput, optionalJsonInput } from "../common/prisma-json";
import { LlmProviderService } from "../common/llm-provider.service";
import { createId } from "../common/id";

/** 注册输入参数 */
interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

/** 登录输入参数 */
interface LoginInput {
  email: string;
  password: string;
}

/** 刷新令牌输入参数 */
interface RefreshInput {
  refreshToken: string;
}

/** 重置密码输入参数 */
interface ResetPasswordInput {
  token: string;
  nextPassword: string;
}

/** 认证服务，封装所有身份认证与会话管理业务逻辑 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(LlmProviderService) private readonly llmProviderService: LlmProviderService,
  ) {}

  /** 用户注册，首个用户自动成为平台超级管理员，同时创建个人工作室 */
  async register(input: RegisterInput) {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();

    if (!email || !input.password || !displayName) {
      throw new BadRequestException("Email, password, and displayName are required");
    }

    this.validatePasswordStrength(input.password);

    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new ConflictException("Email already registered");
    }

    const userCount = await this.prisma.user.count();
    const now = new Date();
    const passwordHash = await argon2.hash(input.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: {
          id: createId("user"),
          email,
          displayName,
          passwordHash,
          globalRole: userCount === 0 ? "platform_super_admin" : "user",
          createdAt: now,
          updatedAt: now,
        },
      });

      const teamId = createId("team");
      await tx.team.create({
        data: {
          id: teamId,
          name: `${displayName}的个人工作室`,
          slug: teamId,
          defaultReviewPolicy: "bypass",
          createdBy: createdUser.id,
          createdAt: now,
          updatedAt: now,
        },
      });

      await tx.teamMember.create({
        data: {
          id: createId("tm"),
          teamId,
          userId: createdUser.id,
          role: "tenant_owner",
          createdAt: now,
        },
      });

      return createdUser;
    });

    return this.issueSession(this.toUserRecord(user));
  }

  /** 用户登录，验证邮箱和密码 */
  async login(input: LoginInput) {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const isValid = await argon2.verify(user.passwordHash, input.password);
    if (!isValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    return this.issueSession(this.toUserRecord(user));
  }

  /** 使用刷新令牌获取新的访问令牌（旧刷新令牌将失效） */
  async refresh(input: RefreshInput) {
    const token = input.refreshToken?.trim();
    if (!token) {
      throw new BadRequestException("refreshToken is required");
    }

    const allTokens = await this.prisma.refreshToken.findMany();
    let refreshRecord: typeof allTokens[0] | undefined;
    for (const record of allTokens) {
      if (await argon2.verify(record.tokenHash, token)) {
        refreshRecord = record;
        break;
      }
    }

    if (!refreshRecord || new Date(refreshRecord.expiresAt).getTime() < Date.now()) {
      throw new UnauthorizedException("Refresh token is invalid or expired");
    }

    const user = await this.prisma.user.findUnique({ where: { id: refreshRecord.userId } });
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    await this.prisma.refreshToken.delete({ where: { id: refreshRecord.id } });
    return this.issueSession(this.toUserRecord(user));
  }

  /** 用户登出，删除刷新令牌 */
  async logout(input: RefreshInput) {
    const token = input.refreshToken?.trim();
    if (!token) {
      return { ok: true };
    }

    const allTokens = await this.prisma.refreshToken.findMany();
    const idsToDelete: string[] = [];
    for (const record of allTokens) {
      if (await argon2.verify(record.tokenHash, token)) {
        idsToDelete.push(record.id);
      }
    }

    if (idsToDelete.length > 0) {
      await this.prisma.refreshToken.deleteMany({
        where: { id: { in: idsToDelete } },
      });
    }

    return { ok: true };
  }

  /** 发起密码重置流程（开发模式直接返回 token） */
  async forgotPassword(emailValue: string) {
    const email = emailValue.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      return { ok: true, message: "If the account exists, a reset link would be sent." };
    }

    const token = await this.jwtService.signAsync(
      { sub: user.id, scope: "password_reset" },
      {
        secret: process.env.JWT_ACCESS_SECRET ?? "dramaflow-access-secret",
        expiresIn: "15m",
      },
    );

    const isDev = (process.env.NODE_ENV ?? "development") !== "production";
    return {
      ok: true,
      message: isDev
        ? "Development mode returns the reset token directly."
        : "If the account exists, a reset link has been sent.",
      ...(isDev ? { token } : {}),
    };
  }

  /** 执行密码重置 */
  async resetPassword(input: ResetPasswordInput) {
    this.validatePasswordStrength(input.nextPassword);

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string; scope: string }>(input.token, {
        secret: process.env.JWT_ACCESS_SECRET ?? "dramaflow-access-secret",
      });

      if (payload.scope !== "password_reset") {
        throw new UnauthorizedException("Invalid reset token scope");
      }

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      await this.prisma.user.update({
        where: { id: payload.sub },
        data: {
          passwordHash: await argon2.hash(input.nextPassword),
          updatedAt: new Date(),
        },
      });

      return { ok: true };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new UnauthorizedException("Reset token is invalid or expired");
    }
  }

  /** 获取用户公开信息 */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return this.toPublicUser(this.toUserRecord(user));
  }

  /** 更新用户个人信息 */
  async updateProfile(userId: string, input: {
    displayName?: string;
    llmConfig?: LlmProviderConfig;
    imageGenerationConfig?: ImageGenerationConfig;
    imageProviders?: import("@dramaflow/shared").ProviderEntry[];
    videoProviders?: import("@dramaflow/shared").ProviderEntry[];
    defaultImageProvider?: string;
    defaultVideoProvider?: string;
  }) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
        ...(input.llmConfig !== undefined ? { llmConfig: optionalJsonInput(input.llmConfig) } : {}),
        ...(input.imageGenerationConfig !== undefined ? { imageGenerationConfig: optionalJsonInput(input.imageGenerationConfig) } : {}),
        ...(input.imageProviders !== undefined ? { imageProviders: optionalJsonInput(input.imageProviders) } : {}),
        ...(input.videoProviders !== undefined ? { videoProviders: optionalJsonInput(input.videoProviders) } : {}),
        ...(input.defaultImageProvider !== undefined ? { defaultImageProvider: input.defaultImageProvider } : {}),
        ...(input.defaultVideoProvider !== undefined ? { defaultVideoProvider: input.defaultVideoProvider } : {}),
        updatedAt: new Date(),
      },
    });

    return this.getProfile(userId);
  }

  /** 查询用户可用的 LLM 模型列表 */
  async listAvailableModels(userId: string, draftConfig?: LlmProviderConfig): Promise<LlmModelListResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return {
      models: await this.llmProviderService.listModels(
        this.mergeLlmConfig(jsonOutput<LlmProviderConfig>(user.llmConfig), draftConfig),
      ),
    };
  }

  /** 合并已保存的 LLM 配置与草稿配置 */
  private mergeLlmConfig(
    savedConfig?: LlmProviderConfig,
    draftConfig?: LlmProviderConfig,
  ): LlmProviderConfig | undefined {
    if (!savedConfig && !draftConfig) {
      return undefined;
    }

    return {
      ...savedConfig,
      ...draftConfig,
      provider: draftConfig?.provider ?? savedConfig?.provider ?? "openai-completions",
    };
  }

  /** 验证密码强度 */
  private validatePasswordStrength(password: string) {
    if (!password || password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters long");
    }
  }

  /** 签发会话（生成访问令牌 + 刷新令牌） */
  private async issueSession(user: UserRecord) {
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        globalRole: user.globalRole,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET ?? "dramaflow-access-secret",
        expiresIn: "1h",
      },
    );

    const refreshToken = createId("refresh");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const maxRefreshTokensPerUser = 10;

    await this.prisma.$transaction(async (tx) => {
      const userTokens = await tx.refreshToken.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
      });

      if (userTokens.length >= maxRefreshTokensPerUser) {
        const removeCount = userTokens.length - maxRefreshTokensPerUser + 1;
        await tx.refreshToken.deleteMany({
          where: { id: { in: userTokens.slice(0, removeCount).map((item) => item.id) } },
        });
      }

      await tx.refreshToken.create({
        data: {
          id: createId("rt"),
          userId: user.id,
          tokenHash: await argon2.hash(refreshToken),
          expiresAt: new Date(expiresAt),
          createdAt: now,
        },
      });
    });

    return {
      user: this.toPublicUser(user),
      accessToken,
      refreshToken,
      expiresAt,
    };
  }

  /** 将 Prisma 用户对象转换为 UserRecord */
  private toUserRecord(user: {
    id: string;
    email: string;
    displayName: string;
    passwordHash: string;
    globalRole: UserRecord["globalRole"];
    llmConfig: unknown;
    imageGenerationConfig: unknown;
    imageProviders: unknown;
    videoProviders: unknown;
    defaultImageProvider: string | null;
    defaultVideoProvider: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserRecord {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      passwordHash: user.passwordHash,
      globalRole: user.globalRole,
      llmConfig: jsonOutput<UserRecord["llmConfig"]>(user.llmConfig),
      imageGenerationConfig: jsonOutput<UserRecord["imageGenerationConfig"]>(user.imageGenerationConfig),
      imageProviders: jsonOutput<UserRecord["imageProviders"]>(user.imageProviders),
      videoProviders: jsonOutput<UserRecord["videoProviders"]>(user.videoProviders),
      defaultImageProvider: user.defaultImageProvider ?? undefined,
      defaultVideoProvider: user.defaultVideoProvider ?? undefined,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  /** 将用户记录转换为公开信息（排除敏感字段） */
  private toPublicUser(user: UserRecord) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      globalRole: user.globalRole,
      llmConfig: user.llmConfig,
      imageGenerationConfig: user.imageGenerationConfig,
      imageProviders: user.imageProviders,
      videoProviders: user.videoProviders,
      defaultImageProvider: user.defaultImageProvider,
      defaultVideoProvider: user.defaultVideoProvider,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
