// DeepSeek rewrites each action's note in the agent's own plain voice.
// Optional: without DEEPSEEK_API_KEY the computed notes are used as-is.

const PERSONAS = {
  aim: 'Aim, the trader. Keeps the stock portfolio on target. Calm, precise.',
  yield: 'Yield, the lender. Puts idle cash to work. Patient, dry humour.',
  depth: 'Depth, the market maker. Provides liquidity to busy pools. Practical.',
  scout: 'Scout, the data seller. Reads every pool and sells the read to other agents. Quick, sharp.',
};

export async function narrate(actions) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return actions;

  const items = actions.map((a, i) => ({ i, agent: a.agent, persona: PERSONAS[a.agent], facts: a.note }));
  const body = {
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    temperature: 0.7,
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You write one-line log entries for AI agents working on Robinhood Chain. ' +
          'Rewrite each item\'s facts in first person, in that agent\'s voice. ' +
          'Keep every number, ticker and the word "est." exactly as given. Never invent numbers. ' +
          'Max 140 characters each. No emojis, no hashtags, no hype words. ' +
          'Reply as JSON: {"lines":[{"i":0,"text":"..."}]}',
      },
      { role: 'user', content: JSON.stringify(items) },
    ],
  };

  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`deepseek ${res.status}`);
    const data = await res.json();
    const lines = JSON.parse(data.choices[0].message.content).lines || [];
    return actions.map((a, i) => {
      const line = lines.find((l) => l.i === i)?.text;
      return keepsNumbers(a.note, line) ? { ...a, note: line.slice(0, 160) } : a;
    });
  } catch (err) {
    console.warn('narrate:', err.message);
    return actions;
  }
}

// Reject a rewrite that dropped or changed any number from the facts.
function keepsNumbers(facts, line) {
  if (typeof line !== 'string' || !line.trim()) return false;
  const nums = facts.match(/\d[\d,.]*/g) || [];
  return nums.every((n) => line.includes(n.replace(/[.,]$/, '')));
}
