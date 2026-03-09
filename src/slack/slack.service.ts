import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';
import { BlueprintService } from '../blueprint/blueprint.service.js';

@Injectable()
export class SlackService implements OnModuleInit {
  private readonly logger = new Logger(SlackService.name);
  private app: App;

  constructor(
    private configService: ConfigService,
    private blueprintService: BlueprintService,
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

      const msg = await client.chat.postMessage({
        channel: command.channel_id,
        text: ':robot_face: Minion starting run...',
      });

      const threadTs = msg.ts!;
      const channelId = command.channel_id;

      this.logger.log(`Thread started: channel=${channelId} thread_ts=${threadTs}`);

      // fire and forget -- do NOT await
      this.blueprintService
        .run(
          {
            prompt: command.text,
            channelId,
            threadTs,
          },
          async (stepName, status, detail) => {
            const emoji =
              status === 'running'
                ? ':hourglass_flowing_sand:'
                : status === 'success'
                  ? ':white_check_mark:'
                  : ':x:';
            let text = `${emoji} ${stepName}`;
            if (status === 'failed' && detail) {
              text += `\n\`\`\`${detail}\`\`\``;
            }
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text,
            });
          },
        )
        .then(async (finalOutput) => {
          this.logger.log('Blueprint run completed successfully');
          // Check if final output contains a PR URL
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
          this.logger.error(`Blueprint run failed: ${(err as Error).message}`, (err as Error).stack);
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `:x: Minion run failed: ${(err as Error).message}`,
          });
        });
    });
  }
}
