import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type {
  RealtimeJobUpdatedEvent,
  RealtimeNotificationCreatedEvent,
  RealtimeProjectSubscriptionPayload,
  RealtimeReviewUpdatedEvent,
} from "@dramaflow/shared";
import type { Server, Socket } from "socket.io";

import { DevDatabaseService } from "../common/dev-database.service";

@Injectable()
@WebSocketGateway({
  cors: {
    origin: process.env.APP_URL ?? "http://localhost:3000",
    credentials: true,
  },
  transports: ["websocket"],
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? "dramaflow-access-secret",
      });

      const user = await this.database.query((db) => db.users.find((item) => item.id === payload.sub));
      if (!user) {
        client.disconnect(true);
        return;
      }

      client.data.userId = user.id;
      await client.join(this.getUserRoom(user.id));
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage("project.subscribe")
  async handleProjectSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RealtimeProjectSubscriptionPayload,
  ) {
    if (!payload?.projectId || !client.data.userId) {
      return { ok: false };
    }

    const allowed = await this.canAccessProject(client.data.userId as string, payload.projectId);
    if (!allowed) {
      return { ok: false, projectId: payload.projectId };
    }

    await client.join(this.getProjectRoom(payload.projectId));
    return { ok: true, projectId: payload.projectId };
  }

  @SubscribeMessage("project.unsubscribe")
  async handleProjectUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RealtimeProjectSubscriptionPayload,
  ) {
    if (!payload?.projectId) {
      return { ok: false };
    }

    await client.leave(this.getProjectRoom(payload.projectId));
    return { ok: true, projectId: payload.projectId };
  }

  emitJobUpdated(event: RealtimeJobUpdatedEvent): void {
    this.server.to(this.getProjectRoom(event.projectId)).emit("job.updated", event);
  }

  emitReviewUpdated(event: RealtimeReviewUpdatedEvent): void {
    this.server.to(this.getProjectRoom(event.projectId)).emit("review.updated", event);
  }

  emitNotificationCreated(userId: string, event: RealtimeNotificationCreatedEvent): void {
    this.server.to(this.getUserRoom(userId)).emit("notification.created", event);
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === "string" && authToken.trim()) {
      return authToken.trim();
    }

    const header = client.handshake.headers.authorization;
    if (typeof header === "string" && header.startsWith("Bearer ")) {
      return header.slice("Bearer ".length).trim();
    }

    return null;
  }

  private async canAccessProject(userId: string, projectId: string): Promise<boolean> {
    return this.database.query((db) => {
      const project = db.projects.find((item) => item.id === projectId);
      if (!project) {
        return false;
      }

      const user = db.users.find((item) => item.id === userId);
      if (!user) {
        return false;
      }

      if (user.globalRole === "platform_super_admin") {
        return true;
      }

      const hasTeamAccess = db.teamMembers.some((member) => member.teamId === project.teamId && member.userId === userId);
      const hasProjectAccess = db.projectMembers.some((member) => member.projectId === projectId && member.userId === userId);
      return hasTeamAccess || hasProjectAccess;
    });
  }

  private getUserRoom(userId: string): string {
    return `user:${userId}`;
  }

  private getProjectRoom(projectId: string): string {
    return `project:${projectId}`;
  }
}