interface ParsedVersion {
  numbers: [number, number, number];
  prerelease?: string;
}

function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (!match) return undefined;
  const numbers = match.slice(1, 4).map(Number) as [number, number, number];
  if (numbers.some((part) => !Number.isSafeInteger(part))) return undefined;
  return { numbers, prerelease: match[4] };
}

export function compareReleaseVersions(left: string, right: string): number | undefined {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return undefined;
  for (let index = 0; index < parsedLeft.numbers.length; index += 1) {
    const difference = parsedLeft.numbers[index] - parsedRight.numbers[index];
    if (difference !== 0) return Math.sign(difference);
  }
  if (parsedLeft.prerelease === parsedRight.prerelease) return 0;
  if (!parsedLeft.prerelease) return 1;
  if (!parsedRight.prerelease) return -1;
  return parsedLeft.prerelease.localeCompare(parsedRight.prerelease);
}

export function isNewerRelease(candidate: string, current: string): boolean {
  return compareReleaseVersions(candidate, current) === 1;
}
