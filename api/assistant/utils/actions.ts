// Action extraction + sanitization helpers extracted from original assistantHandlers
export function extractActionsFromText(text: string) {
  const actions: any[] = [];
  const codeFenceMatches = text.match(/```(?:json)?\n([\s\S]*?)```/g) || [];
  const candidates: string[] = [];
  codeFenceMatches.forEach(block => {
    const inner = block.replace(/```(?:json)?\n?|```/g, '').trim();
    candidates.push(inner);
  });
  const braceOrArrayMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (codeFenceMatches.length === 0 && braceOrArrayMatch) candidates.push(braceOrArrayMatch[0]);
  const seen = new Set<string>();
  function consider(parsed: any) {
    if (!parsed) return;
    if (Array.isArray(parsed)) { parsed.forEach(p => consider(p)); return; }
    if (parsed && Array.isArray(parsed.actions)) { parsed.actions.forEach((p: any) => consider(p)); }
    if (parsed.action || parsed.type) {
      const key = JSON.stringify(parsed);
      if (!seen.has(key)) { actions.push(parsed); seen.add(key); }
    } else if (parsed.summary && (parsed.start || parsed.end)) {
      const wrapped = { action: 'create_event', event: parsed };
      const wKey = JSON.stringify(wrapped);
      if (!seen.has(wKey)) { actions.push(wrapped); seen.add(wKey); }
    }
  }
  candidates.forEach(c => { try { consider(JSON.parse(c)); } catch {/* ignore */} });
  return actions;
}

export function stripActionJsonFragments(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/```json[\s\S]*?```/gi, '').replace(/```[\s\S]*?```/g, '');
  cleaned = cleaned.replace(/\{[^{}]*"action"[^{}]*\}/g, '');
  cleaned = cleaned.replace(/\{[^{}]*"actions"\s*:\s*\[[\s\S]*?]\s*}/g, '');
  cleaned = cleaned.replace(/\{[^{}]*"dateTime"[^{}]*"timeZone"[^{}]*\}/g, '');
  cleaned = cleaned.split(/\n/).filter(l => !/^\s*[\[\]{},]*\s*$/.test(l)).join('\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/^[,\s]+/,'').replace(/[,\s]+$/,'').trim();
  return cleaned;
}
