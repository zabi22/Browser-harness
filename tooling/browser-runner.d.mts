export interface BrowserRunnerOptions {
  target: string;
  appOrigin: string;
  port?: number;
  allowLocalTarget?: boolean;
  maxAgeMs?: number;
  channel?: "chrome" | "msedge";
}
export interface LocalBrowserRunner {
  endpoint: string;
  pairingToken: string;
  close(): Promise<void>;
}
export function startBrowserRunner(options: BrowserRunnerOptions): Promise<LocalBrowserRunner>;
