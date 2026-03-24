import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface EnrichedShot {
  id: string;
  name: string;
  videoId: string;
  category: 'putaway' | 'counter' | 'drive' | 'reset' | 'serve' | 'other';
  startTime: number;
  subtitle: string | null;
  technique: { label: string; cue: string }[];
  errors: { badge: string; description: string }[];
  tip: string | null;
  grip: string | null;
  swingDirection: 'low-to-high' | 'flat' | 'high-to-low' | null;
  finishPosition: string | null;
  relatedShots: string[];
  expandDetails: string[];
  confidence: 'high' | 'medium' | 'low';
}

interface VideoSearchResult {
  videoId: string;
  title: string;
}

@Injectable()
export class EnrichmentService {
  private readonly logger = new Logger(EnrichmentService.name);
  private anthropic: Anthropic;

  constructor(private configService: ConfigService) {
    this.anthropic = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  async searchVideo(query: string): Promise<VideoSearchResult> {
    const apiKey = this.configService.get<string>('YOUTUBE_API_KEY');
    const channelId = this.configService.get<string>('YOUTUBE_CHANNEL_ID');
    const searchQuery = `pickleball ${query}`;

    this.logger.log(`[enrichment] Searching YouTube for "${searchQuery}" on channel ${channelId}`);

    const params = new URLSearchParams({
      part: 'snippet',
      q: searchQuery,
      channelId: channelId!,
      type: 'video',
      maxResults: '1',
      key: apiKey!,
    });

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${params}`,
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`YouTube search failed (${response.status}): ${body}`);
    }

    const data = await response.json();
    if (!data.items || data.items.length === 0) {
      throw new Error(`No videos found for "${searchQuery}" on channel ${channelId}`);
    }

    const item = data.items[0];
    const result: VideoSearchResult = {
      videoId: item.id.videoId,
      title: item.snippet.title,
    };

    this.logger.log(`[enrichment] Found: "${result.title}" (${result.videoId})`);
    return result;
  }

  async getTranscript(videoId: string): Promise<string> {
    this.logger.log(`[enrichment] Fetching transcript for ${videoId}`);

    const { YoutubeTranscript } = await import('youtube-transcript-plus');

    const proxyUrl = this.configService.get<string>('PROXY_URL', '');
    const config: Record<string, unknown> = {};

    if (proxyUrl) {
      this.logger.log(`[enrichment] Using residential proxy for transcript fetch`);
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      const agent = new HttpsProxyAgent(proxyUrl);
      const proxyFetch = async (params: { url: string; headers?: Record<string, string>; body?: string }) => {
        const nodeFetch = (await import('node-fetch')).default;
        const resp = await nodeFetch(params.url, {
          method: params.body ? 'POST' : 'GET',
          headers: params.headers,
          body: params.body,
          agent,
        });
        return resp as unknown as Response;
      };
      config.videoFetch = proxyFetch;
      config.playerFetch = proxyFetch;
      config.transcriptFetch = proxyFetch;
    }

    const segments = await YoutubeTranscript.fetchTranscript(videoId, config);

    const transcript = segments
      .map((s: { offset: number; text: string }) => `[${Math.round(s.offset / 1000)}s] ${s.text}`)
      .join(' ');

    this.logger.log(`[enrichment] Transcript: ${transcript.length} chars, ${segments.length} segments`);
    return transcript;
  }

  async structureShots(transcript: string, shotName: string): Promise<EnrichedShot[]> {
    this.logger.log(`[enrichment] Structuring shots from transcript (${transcript.length} chars)`);

    const prompt = `You are analyzing a pickleball instructional video transcript. Extract all distinct shots or techniques taught in this video.

For each shot, return a JSON object with these fields:
- name: string (the shot/technique name)
- category: one of "putaway", "counter", "drive", "reset", "serve", "other"
- startTime: number (seconds into the video where this shot's instruction begins, from the [Xs] timestamps)
- subtitle: string | null (brief description of when to use this shot)
- technique: array of { label: string, cue: string } (key technical points — label is the aspect like "Grip", "Contact", cue is the instruction)
- errors: array of { badge: string, description: string } (common mistakes)
- tip: string | null (one mental cue or key takeaway)
- grip: string | null (grip type if mentioned)
- swingDirection: "low-to-high" | "flat" | "high-to-low" | null
- finishPosition: string | null (where the paddle/hand finishes)
- relatedShots: string[] (names of related shots mentioned)
- expandDetails: string[] (additional tips and details for an expandable section)
- confidence: "high" | "medium" | "low" (how confident you are in the extraction)

The user is specifically looking for information about: "${shotName}"

Return ONLY a JSON array of shot objects. No markdown, no explanation, just the JSON array.

Transcript:
${transcript}`;

    const response = await this.anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      // Try extracting JSON from markdown code block
      const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('Could not parse Claude response as JSON');
      }
      parsed = JSON.parse(jsonMatch[0]);
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Claude response is not an array');
    }

    const shots = parsed as EnrichedShot[];
    this.logger.log(`[enrichment] Structured ${shots.length} shots`);
    return shots;
  }
}
