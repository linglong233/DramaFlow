import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import argon2 from "argon2";

import type { UserRecord } from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";
import { createId } from "../common/id";

interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

interface LoginInput {
  email: string;
  password: string;
}

interface RefreshInput {
  refreshToken: string;
}

interface ResetPasswordInput {
  token: string;
  nextPassword: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
    @Inject(JwtService) private readonly jwtService: JwtService,
  ) {}

  async register(input: RegisterInput) {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();

    if (!email || !input.password || !displayName) {
      throw new BadRequestException("Email, password, and displayName are required");
    }

    const existingUser = await this.database.query((db) =>
      db.users.find((user) => user.email === email),
    );

    if (existingUser) {
      throw new ConflictException("Email already registered");
    }

    const userCount = await this.database.query((db) => db.users.length);
    const now = new Date().toISOString();
    const user: UserRecord = {
      id: createId("user"),
      email,
      displayName,
      passwordHash: await argon2.hash(input.password),
      globalRole: userCount === 0 ? "platform_super_admin" : "user",
      createdAt: now,
      updatedAt: now,
    };

    await this.database.mutate((db) => {
      db.users.push(user);

      const teamId = createId("team");
      db.teams.push({
        id: teamId,
        name: `${displayName}的个人工作室`,
        slug: teamId,
        defaultReviewPolicy: "bypass",
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      });

      db.teamMembers.push({
        id: createId("tm"),
        teamId: teamId,
        userId: user.id,
        role: "tenant_owner",
        createdAt: now,
      });
    });

    return this.issueSession(user);
  }

  async login(input: LoginInput) {
    const email = input.email.trim().toLowerCase();
    const user = await this.database.query((db) =>
      db.users.find((item) => item.email === email),
    );

    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const isValid = await argon2.verify(user.passwordHash, input.password);
    if (!isValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    return this.issueSession(user);
  }

  async refresh(input: RefreshInput) {
    const token = input.refreshToken?.trim();
    if (!token) {
      throw new BadRequestException("refreshToken is required");
    }

    const refreshRecord = await this.database.query(async (db) => {
      for (const record of db.refreshTokens) {
        const matches = await argon2.verify(record.tokenHash, token);
        if (matches) {
          return record;
        }
      }

      return undefined;
    });

    if (!refreshRecord || new Date(refreshRecord.expiresAt).getTime() < Date.now()) {
      throw new UnauthorizedException("Refresh token is invalid or expired");
    }

    const user = await this.database.query((db) =>
      db.users.find((item) => item.id === refreshRecord.userId),
    );

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    await this.database.mutate((db) => {
      db.refreshTokens = db.refreshTokens.filter((item) => item.id !== refreshRecord.id);
    });

    return this.issueSession(user);
  }

  async logout(input: RefreshInput) {
    const token = input.refreshToken?.trim();
    if (!token) {
      return { ok: true };
    }

    const records = await this.database.query((db) => db.refreshTokens);
    const idsToDelete: string[] = [];

    for (const record of records) {
      if (await argon2.verify(record.tokenHash, token)) {
        idsToDelete.push(record.id);
      }
    }

    if (idsToDelete.length > 0) {
      await this.database.mutate((db) => {
        db.refreshTokens = db.refreshTokens.filter((item) => !idsToDelete.includes(item.id));
      });
    }

    return { ok: true };
  }

  async forgotPassword(emailValue: string) {
    const email = emailValue.trim().toLowerCase();
    const user = await this.database.query((db) =>
      db.users.find((item) => item.email === email),
    );

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

    return {
      ok: true,
      message: "Development mode returns the reset token directly.",
      token,
    };
  }

  async resetPassword(input: ResetPasswordInput) {
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string; scope: string }>(input.token, {
        secret: process.env.JWT_ACCESS_SECRET ?? "dramaflow-access-secret",
      });

      if (payload.scope !== "password_reset") {
        throw new UnauthorizedException("Invalid reset token scope");
      }

      await this.database.mutate(async (db) => {
        const user = db.users.find((item) => item.id === payload.sub);
        if (!user) {
          throw new UnauthorizedException("User not found");
        }

        user.passwordHash = await argon2.hash(input.nextPassword);
        user.updatedAt = new Date().toISOString();
      });

      return { ok: true };
    } catch {
      throw new UnauthorizedException("Reset token is invalid or expired");
    }
  }

  async getProfile(userId: string) {
    const user = await this.database.query((db) =>
      db.users.find((item) => item.id === userId),
    );

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    return this.toPublicUser(user);
  }

  private async issueSession(user: UserRecord) {
    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        globalRole: user.globalRole,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET ?? "dramaflow-access-secret",
        expiresIn: "12h",
      },
    );

    const refreshToken = createId("refresh");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString();

    await this.database.mutate(async (db) => {
      db.refreshTokens.push({
        id: createId("rt"),
        userId: user.id,
        tokenHash: await argon2.hash(refreshToken),
        expiresAt,
        createdAt: now.toISOString(),
      });
    });

    return {
      user: this.toPublicUser(user),
      accessToken,
      refreshToken,
      expiresAt,
    };
  }

  private toPublicUser(user: UserRecord) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      globalRole: user.globalRole,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
