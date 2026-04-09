import { Injectable } from "@nestjs/common";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  CreateUploadTargetInput,
  PutObjectInput,
  StorageProvider,
} from "@dramaflow/shared";

@Injectable()
export class S3StorageProvider implements StorageProvider {
  private readonly bucket = process.env.S3_BUCKET ?? "dramaflow";
  private readonly endpoint = process.env.S3_ENDPOINT;
  private readonly client = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: this.endpoint,
    credentials: process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY,
          secretAccessKey: process.env.S3_SECRET_KEY,
        }
      : undefined,
    forcePathStyle: Boolean(this.endpoint),
  });

  async putObject(input: PutObjectInput): Promise<{ key: string; publicUrl?: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );

    return {
      key: input.key,
      publicUrl: await this.getObjectUrl(input.key),
    };
  }

  async getObjectUrl(key: string): Promise<string> {
    if (this.endpoint) {
      return `${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${key}`;
    }

    return `https://${this.bucket}.s3.amazonaws.com/${key}`;
  }

  async readObject(key: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = response.Body;
    if (!body) {
      return new Uint8Array();
    }

    if (body instanceof Uint8Array) {
      return body;
    }

    if (typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray === "function") {
      return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
      if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk));
      } else if (chunk instanceof Uint8Array) {
        chunks.push(chunk);
      } else {
        chunks.push(Buffer.from(chunk));
      }
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async copyObject(sourceKey: string, targetKey: string): Promise<{ key: string; publicUrl?: string }> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: targetKey,
        CopySource: `${this.bucket}/${sourceKey}`,
      }),
    );

    return {
      key: targetKey,
      publicUrl: await this.getObjectUrl(targetKey),
    };
  }

  async createUploadTarget(input: CreateUploadTargetInput) {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.contentType,
      }),
      { expiresIn: 60 * 10 },
    );

    return {
      driver: "s3" as const,
      key: input.key,
      method: "PUT" as const,
      url,
      headers: {
        "content-type": input.contentType,
      },
      publicUrl: await this.getObjectUrl(input.key),
    };
  }
}