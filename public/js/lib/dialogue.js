// Dialogue rules: per-character state (met, asked question ids) read from
// the stored state (lib/state.js), and the maxQuestions cap. Pure.

/**
 * @param {{ met: string[] }} state stored state (lib/state.js)
 * @param {string} id character id
 */
export function isMet(state, id) {
  return state.met.includes(id);
}

/**
 * Question ids already asked of a character, in the order asked.
 * @param {{ asked: Record<string, string[]> }} state
 * @param {string} id
 * @returns {string[]}
 */
export function askedIds(state, id) {
  return Object.prototype.hasOwnProperty.call(state.asked, id) ? [...state.asked[id]] : [];
}

/**
 * How many of the character's own questions have been asked. Ids that are no
 * longer in characters.json (content edited since) do not count.
 * @param {{ questions: Array<{ id: string }> }} character
 * @param {Iterable<string>} asked
 */
export function askedCount(character, asked) {
  const set = new Set(asked);
  return character.questions.filter((q) => set.has(q.id)).length;
}

/**
 * True when the pair has asked as many questions as `maxQuestions` allows.
 * `maxQuestions: null` means no cap.
 * @param {{ maxQuestions: number|null, questions: Array<{ id: string }> }} character
 * @param {Iterable<string>} asked
 */
export function capReached(character, asked) {
  const max = character.maxQuestions;
  return max !== null && max !== undefined && askedCount(character, asked) >= max;
}

/**
 * @typedef {object} QuestionOption
 * @property {string} id
 * @property {string} text
 * @property {string} answer
 * @property {boolean} asked
 * @property {boolean} disabled true for an unasked question once the cap is reached
 */

/**
 * The question list as the dialogue shows it. Asked questions stay
 * available (asking again repeats the answer and costs nothing); once the
 * cap is reached the unasked ones are disabled.
 * @param {{ maxQuestions: number|null, questions: Array<{ id: string, text: string, answer: string }> }} character
 * @param {Iterable<string>} asked
 * @returns {{ options: QuestionOption[], capReached: boolean }}
 */
export function questionOptions(character, asked) {
  const set = new Set(asked);
  const full = capReached(character, set);
  return {
    capReached: full,
    options: character.questions.map((q) => ({
      id: q.id,
      text: q.text,
      answer: q.answer,
      asked: set.has(q.id),
      disabled: full && !set.has(q.id),
    })),
  };
}

/**
 * Whether a question may be asked now: it exists and is not disabled by the cap.
 * @param {{ maxQuestions: number|null, questions: Array<{ id: string }> }} character
 * @param {Iterable<string>} asked
 * @param {string} questionId
 */
export function canAsk(character, asked, questionId) {
  const set = new Set(asked);
  if (!character.questions.some((q) => q.id === questionId)) return false;
  return set.has(questionId) || !capReached(character, set);
}
