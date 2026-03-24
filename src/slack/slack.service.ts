import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';
import { BlueprintService } from '../blueprint/blueprint.service.js';
import { ShotsPipelineService } from '../shots/shots-pipeline.service.js';

const SHOTS_ADD_REGEX = /^shots\s+add\s+["\u201C]([^"\u201D]+)["\u201D]/;

@Injectable()
export class SlackService implements OnModuleInit {
  private readonly logger = new Logger(SlackService.name);
  private app: App;

  constructor(
    private configService: ConfigService,
    private blueprintService: BlueprintService,
    private shotsPipelineService: ShotsPipelineService,
  ) {
    this.app = new App({
      token: this.configService.get<string>('SLACK_BOT_TOKEN'),
      appToken: this.configService.get<string>('SLACK_APP_TOKEN'),
      socketMode: true,
    });
  }

  async onModuleInit() {
    this.registerCommands();
    await this.app.start();
    this.logger.log('Slack bot started in Socket Mode');
  }

  private registerCommands() {
    this.app.command('/minion', async ({ command, ack, client }) => {
      await ack(); // must be called first, always under 3 seconds

      this.logger.log(`Received /minion command from user=${command.user_id} channel=${command.channel_id}`);
      this.logger.log(`Prompt: "${command.text}"`);

      const shotsMatch = command.text.match(SHOTS_ADD_REGEX);

      const msg = await client.chat.postMessage({
        channel: command.channel_id,
        text: shotsMatch
          ? `:basketball: Minion shots pipeline starting for "${shotsMatch[1]}"...`
          : ':robot_face: Minion starting run...',
      });

      const threadTs = msg.ts!;
      const channelId = command.channel_id;

      this.logger.log(`Thread started: channel=${channelId} thread_ts=${threadTs}`);

      const stepUpdateCallback = async (stepName: string, status: 'running' | 'success' | 'failed', detail?: string) => {
        const emoji =
          status === 'running'
            ? ':hourglass_flowing_sand:'
            : status === 'success'
              ? ':white_check_mark:'
              : ':x:';
        let text = `${emoji} ${stepName}`;
        if (detail) {
          text += status === 'failed' ? `\n\`\`\`${detail}\`\`\`` : ` — ${detail}`;
        }
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text,
        });
      };

      // Route to shots pipeline or default coding task
      const runPromise = shotsMatch
        ? this.shotsPipelineService.run(shotsMatch[1], channelId, threadTs, stepUpdateCallback)
        : this.blueprintService.run(
            { prompt: command.text, channelId, threadTs },
            stepUpdateCallback,
          );

      // fire and forget -- do NOT await
      runPromise
        .then(async (finalOutput) => {
          this.logger.log('Run completed successfully');
          const prUrlMatch = finalOutput.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
          if (prUrlMatch) {
            this.logger.log(`PR URL found: ${prUrlMatch[0]}`);
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: `:tada: PR opened: ${prUrlMatch[0]}`,
            });
          } else {
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: ':white_check_mark: Minion run complete.',
            });
          }
        })
        .catch(async (err) => {
          this.logger.error(`Run failed: ${(err as Error).message}`, (err as Error).stack);
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `:x: Minion run failed: ${(err as Error).message}`,
          });
        });
    });
  }
}
