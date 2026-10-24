/** Guest command scripts must live on host9p, not guest-only /tmp mounts. */
export function commandScriptPath(token: string) {
  return `/obh-command-${token}.sh`;
}

export function cleanConsole(text: string) {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "");
}

export function atConsoleBottom(
  el: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
}
