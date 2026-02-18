// ASCII 아트 배너
import * as p from '@clack/prompts';

const BANNER = `
  ____  _                      ____ _
 |  _ \\| |__   ___  _ __   ___/ ___| | __ ___      __
 | |_) | '_ \\ / _ \\| '_ \\ / _ \\ |   | |/ _\` \\ \\ /\\ / /
 |  __/| | | | (_) | | | |  __/ |___| | (_| |\\ V  V /
 |_|   |_| |_|\\___/|_| |_|\\___|\\____|_|\\__,_| \\_/\\_/
`;

export function showBanner(): void {
  console.log(BANNER);
  p.intro('PhoneClaw Setup');
}
