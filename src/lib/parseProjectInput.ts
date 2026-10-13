import type { ParsedInput } from '@/lib/engagementTypes';

export function parseProjectInput(value: string): ParsedInput {
  const input = value.trim();
  if (!input) return { error: 'Paste an Aippy share link, share code, or numeric project ID.' };

  const shareLink = input.match(/^https?:\/\/share\.aippy\.ai\/p\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i);
  if (shareLink) return { shareCode: shareLink[1] };

  const shareMatch = input.match(/[?&]s=([^&#]*)/i);
  if (shareMatch) {
    let shareCode = '';
    try { shareCode = decodeURIComponent(shareMatch[1].replace(/\+/g, ' ')).trim(); }
    catch { return { error: 'The share code in this link could not be read.' }; }
    return shareCode ? { shareCode } : { error: 'This share link has an empty ?s= value.' };
  }

  const projectPath = input.match(/(?:^|\/)project\/([^/?#]+)/i);
  if (projectPath) return /^\d+$/.test(projectPath[1])
    ? { projectId: projectPath[1] }
    : { error: 'This project link does not contain a numeric project ID.' };

  if (/^\d+$/.test(input)) return { projectId: input };
  if (/^[A-Za-z0-9_-]+$/.test(input)) return { shareCode: input };
  return { error: 'Expected a project ID, /project/123, ?s=CODE, or share.aippy.ai/p/CODE.' };
}
