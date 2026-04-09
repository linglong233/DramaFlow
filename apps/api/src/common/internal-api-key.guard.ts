import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  private readonly expectedKey =
    process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key";

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
