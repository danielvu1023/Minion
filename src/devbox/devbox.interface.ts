export interface IDevboxProvider {
  start(repoPath?: string): Promise<void>;
  exec(command: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<string>;
  getWorkDir(): string;
  stop(): Promise<void>;
}
