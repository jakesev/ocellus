// passages.js — the reading-speed test material. One original, engaging story
// (motivational, concrete, plain vocabulary — a WPM test must not be a vocab
// test), split into ~90-word sections. Quick = first 2 sections (~1 min),
// Full = all 4 (~2 min, twice as long → steadier, more accurate estimate).

export const STORY_TITLE = 'The Four A.M. Baker';

export const STORY_PAGES = [
  'Maya unlocked the bakery at four in the morning, when the street was still black and the only sound was her own key in the door. She was twenty-six, broke, and the third owner of a shop that had already failed twice. Everyone had an opinion about that. Her uncle said the location was cursed. Her bank said the numbers were impossible. Maya taped both letters above the oven — the rejection and the warning — and lit the pilot light anyway. If she was going to fail, she would fail warm.',

  'The first month she sold eleven loaves a day and threw away nine. So she stood at the counter and asked every customer one question: what did you eat for breakfast as a kid? A retired ferry captain said cinnamon toast, cut thick, with too much butter. A night-shift nurse said her grandmother’s honey bread. Maya wrote every answer in a green notebook. Then she stopped baking what a bakery was supposed to sell, and started baking people’s memories. The line outside began quietly — three strangers long, on a rainy Tuesday.',

  'It did not happen fast. It happened daily. She learned that the ovens ran hot on the left, that rain doubled the coffee orders, and that the captain arrived at ten past six exactly and liked his toast cut into triangles. She raised her prices once, apologised for a week, and watched nobody leave. When the mixer broke, four customers carried their own from home and lined them up on the counter like a rescue crew. You do not build a business, she told her sister. You keep a promise, morning after morning, until it multiplies.',

  'Two winters later, the bank that had refused her wrote again — this time asking to feature the bakery in its small-business campaign. Maya taped the new letter above the oven, next to the old rejection. Same wall, same tape. Reporters asked for her secret and looked disappointed by the answer: show up at four, ask real questions, write things down, keep the promise. On her worst morning she had baked eleven loaves nobody wanted. On her best, she sold out by nine — and the captain still got his triangles. She kept both mornings. That was the whole trick.',
];

export const SHORT_PAGES = STORY_PAGES.slice(0, 2);

export function pagesWordCount(pages) {
  return pages.join(' ').trim().split(/\s+/).filter(Boolean).length;
}
