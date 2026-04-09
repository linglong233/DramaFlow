import { Injectable } from "@nestjs/common";
import type { LlmProviderConfig } from "@dramaflow/shared";
import type { VoiceInfo } from "@dramaflow/shared";

export interface TTSParams {
  text: string;
  voiceId: string;
  speed?: number;
}

export interface TTSResult {
  audioBuffer: Buffer;
  mimeType: string;
  duration: number;
  fileExtension: string;
}

interface ITTSAdapter {
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(params: TTSParams): Promise<TTSResult>;
}

class MockTTSAdapter implements ITTSAdapter {
  async listVoices(): Promise<VoiceInfo[]> {
    return [
      { id: "mock-female-1", name: "Mock Female 1", provider: "mock" },
      { id: "mock-female-2", name: "Mock Female 2", provider: "mock" },
      { id: "mock-male-1", name: "Mock Male 1", provider: "mock" },
      { id: "mock-male-2", name: "Mock Male 2", provider: "mock" },
      { id: "mock-narrator", name: "Mock Narrator", provider: "mock" },
    ];
  }

  async synthesize(params: TTSParams): Promise<TTSResult> {
    // Generate a minimal WAV file as placeholder
    const sampleRate = 22050;
    const estimatedDuration = Math.max(1, params.text.length * 0.08);
    const numSamples = Math.floor(sampleRate * estimatedDuration);
    const dataSize = numSamples * 2;
    const buffer = Buffer.alloc(44 + dataSize);

    // WAV header
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Silent audio data (already zeroed by Buffer.alloc)

    return {
      audioBuffer: buffer,
      mimeType: "audio/wav",
      duration: estimatedDuration,
      fileExtension: "wav",
    };
  }
}

class OpenAiTTSAdapter implements ITTSAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async listVoices(): Promise<VoiceInfo[]> {
    return [
      { id: "alloy", name: "Alloy", provider: "openai" },
      { id: "echo", name: "Echo", provider: "openai" },
      { id: "fable", name: "Fable", provider: "openai" },
      { id: "onyx", name: "Onyx", provider: "openai" },
      { id: "nova", name: "Nova", provider: "openai" },
      { id: "shimmer", name: "Shimmer", provider: "openai" },
    ];
  }

  async synthesize(params: TTSParams): Promise<TTSResult> {
    const url = `${this.baseUrl}/audio/speech`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model || "tts-1",
        input: params.text,
        voice: params.voiceId,
        speed: params.speed ?? 1.0,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`OpenAI TTS API error ${response.status}: ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // Estimate duration from file size (MP3 at ~128kbps)
    const estimatedDuration = Math.max(1, (audioBuffer.length * 8) / 128000);

    return {
      audioBuffer,
      mimeType: "audio/mpeg",
      duration: estimatedDuration,
      fileExtension: "mp3",
    };
  }
}

@Injectable()
export class TTSProviderService {
  private createAdapter(config?: LlmProviderConfig): ITTSAdapter {
    const baseUrl = config?.baseUrl || process.env.OPENAI_BASE_URL || "";
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY || "";

    if (!apiKey || !baseUrl) {
      return new MockTTSAdapter();
    }

    const ttsModel = process.env.OPENAI_TTS_MODEL || "tts-1";
    return new OpenAiTTSAdapter(baseUrl, apiKey, ttsModel);
  }

  async listVoices(config?: LlmProviderConfig): Promise<VoiceInfo[]> {
    const adapter = this.createAdapter(config);
    return adapter.listVoices();
  }

  async synthesize(params: TTSParams, config?: LlmProviderConfig): Promise<TTSResult> {
    const adapter = this.createAdapter(config);
    return adapter.synthesize(params);
  }
}
