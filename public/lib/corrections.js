// Exact, reversible correction rules for dictation output.
//
// Two separate ideas:
//   1. The vocabulary *hint* is probabilistic guidance sent to the recognizer.
//   2. A *correction rule* is a deterministic replacement applied after the
//      recognizer returns text.
//
// This module implements only #2. Rules are exact (no fuzzy matching), scoped to
// the Work profile, and applied once per pass so a canonical phrase is never
// rewritten again by another alias.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CorrectionsLib = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const MAX_REPLACEMENTS = 200;
  const MAX_ALIASES_PER_RULE = 20;
  const MAX_TEXT_LENGTH = 100;
  const MAX_CONTEXT_LENGTH = 500;
  const DEFAULT_CONTEXT = 'Company departments and construction risk-management work.';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultGlossary() {
    return {
      schemaVersion: SCHEMA_VERSION,
      activeProfile: 'work',
      profiles: {
        work: {
          context: DEFAULT_CONTEXT,
          terms: ['fund control'],
          replacements: [{
            id: 'work-fund-control',
            canonical: 'fund control',
            aliases: ['fun control'],
            caseInsensitive: true,
            wholePhrase: true,
            enabled: true
          }]
        }
      }
    };
  }

  function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function aliasSource(alias) {
    return alias.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
  }

  function aliasRegex(alias, caseInsensitive, wholePhrase) {
    const flags = 'gu' + (caseInsensitive ? 'i' : '');
    const body = aliasSource(alias);
    if (!wholePhrase) return new RegExp(body, flags);
    // Capture the character before the alias instead of using a lookbehind:
    // lookbehind support is uneven on older iOS Safari.
    return new RegExp('(^|[^\\p{L}\\p{N}_])' + body + '(?=$|[^\\p{L}\\p{N}_])', flags);
  }

  // Validate and normalize a glossary. Throws with a human-readable message on
  // malformed input; callers decide whether to fall back to the default.
  function normalizeGlossary(input) {
    if (input === undefined || input === null || input === '') return defaultGlossary();
    if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Glossary must be an object.');

    const profiles = input.profiles;
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
      throw new Error('Glossary is missing its profiles.');
    }
    const work = profiles.work;
    if (!work || typeof work !== 'object' || Array.isArray(work)) {
      throw new Error('Glossary is missing the Work profile.');
    }

    const context = clean(work.context) || DEFAULT_CONTEXT;
    if (context.length > MAX_CONTEXT_LENGTH) {
      throw new Error(`Profile context must be ${MAX_CONTEXT_LENGTH} characters or fewer.`);
    }

    const rawRules = work.replacements;
    if (rawRules !== undefined && !Array.isArray(rawRules)) {
      throw new Error('Corrections must be a list.');
    }
    if ((rawRules || []).length > MAX_REPLACEMENTS) {
      throw new Error(`Maximum ${MAX_REPLACEMENTS} correction rules.`);
    }

    const rules = [];
    const aliasOwners = new Map();
    const usedIds = new Set();

    (rawRules || []).forEach((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;

      const canonical = clean(raw.canonical);
      let aliases = Array.isArray(raw.aliases) ? raw.aliases : [raw.alias];
      aliases = aliases.map(clean).filter(Boolean);

      // A completely blank row is an unfinished UI row, not an error.
      if (!canonical && !aliases.length) return;
      if (!canonical) throw new Error(`Rule ${index + 1}: replace-with is required.`);
      if (!aliases.length) throw new Error(`Rule ${index + 1}: heard-as is required.`);
      if (canonical.length > MAX_TEXT_LENGTH) {
        throw new Error(`Rule ${index + 1}: replace-with must be ${MAX_TEXT_LENGTH} characters or fewer.`);
      }
      if (aliases.length > MAX_ALIASES_PER_RULE) {
        throw new Error(`Rule ${index + 1}: maximum ${MAX_ALIASES_PER_RULE} heard-as phrases.`);
      }

      const enabled = raw.enabled !== false;
      const finalAliases = [];
      const seenInRule = new Set();
      for (const alias of aliases) {
        if (alias.length > MAX_TEXT_LENGTH) {
          throw new Error(`Rule ${index + 1}: heard-as must be ${MAX_TEXT_LENGTH} characters or fewer.`);
        }
        const key = alias.toLowerCase();
        if (seenInRule.has(key)) continue;
        seenInRule.add(key);
        if (enabled) {
          if (aliasOwners.has(key)) {
            throw new Error(`Heard-as "${alias}" is used by more than one enabled rule.`);
          }
          aliasOwners.set(key, rules.length);
        }
        finalAliases.push(alias);
      }

      let id = typeof raw.id === 'string' ? raw.id.trim() : '';
      if (!id || usedIds.has(id)) id = 'rule-' + (index + 1);
      while (usedIds.has(id)) id += '-x';
      usedIds.add(id);

      rules.push({
        id,
        canonical,
        aliases: finalAliases,
        caseInsensitive: raw.caseInsensitive !== false,
        wholePhrase: raw.wholePhrase !== false,
        enabled
      });
    });

    // A canonical phrase that is also another rule's alias would make a second
    // pass change the text again, breaking idempotence. Reject it up front.
    const loose = value => value.toLowerCase().replace(/\s+/g, ' ');
    rules.forEach((rule, index) => {
      if (!rule.enabled) return;
      const owner = aliasOwners.get(rule.canonical.toLowerCase());
      if (owner !== undefined && owner !== index) {
        throw new Error(`Replace-with "${rule.canonical}" is also heard-as in another rule.`);
      }
      // Even a phrase that merely *contains* another alias can cascade on a
      // second pass ("fund control" + an alias "control"). Reject it so applying
      // the rules twice always gives the same result.
      for (const other of rules) {
        if (!other.enabled) continue;
        for (const alias of other.aliases) {
          if (alias.toLowerCase() === other.canonical.toLowerCase()) continue; // harmless no-op
          // Substring is a necessary condition, so this cheap check skips most
          // regex work (the max rule set is 200 rules x 20 aliases).
          if (!loose(rule.canonical).includes(loose(alias))) continue;
          if (matchesAlias(rule.canonical, alias, other.caseInsensitive, other.wholePhrase)) {
            throw new Error(`Replace-with "${rule.canonical}" contains the alias "${alias}"; this would cascade.`);
          }
        }
      }
    });

    const terms = [];
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!terms.some(t => t.toLowerCase() === rule.canonical.toLowerCase())) terms.push(rule.canonical);
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      activeProfile: 'work',
      profiles: {
        work: { context, terms, replacements: rules }
      }
    };
  }

  function matchesAlias(text, alias, caseInsensitive, wholePhrase) {
    const re = aliasRegex(alias, caseInsensitive, wholePhrase);
    re.lastIndex = 0;
    return re.test(text);
  }

  function getWorkProfile(glossary) {
    if (glossary && glossary.profiles && glossary.profiles.work) return glossary.profiles.work;
    return defaultGlossary().profiles.work;
  }

  // Apply enabled exact aliases to text. Rules are sorted longest-first, and
  // each replacement is temporarily swapped for a private placeholder so a
  // later rule cannot cascade into the text we just inserted.
  function applyCorrections(text, glossary) {
    if (typeof text !== 'string' || !text) return text;
    const profile = getWorkProfile(glossary);
    const entries = [];
    const seen = new Set();

    for (const rule of profile.replacements || []) {
      if (!rule || rule.enabled === false) continue;
      const canonical = clean(rule.canonical);
      if (!canonical) continue;
      for (const rawAlias of rule.aliases || []) {
        const alias = clean(rawAlias);
        if (!alias) continue;
        const key = alias.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({
          alias,
          canonical,
          caseInsensitive: rule.caseInsensitive !== false,
          wholePhrase: rule.wholePhrase !== false,
          order: entries.length
        });
      }
    }

    entries.sort((a, b) => b.alias.length - a.alias.length || a.order - b.order);

    const canonicals = [];
    let out = text;
    for (const entry of entries) {
      const placeholder = '\uE000' + canonicals.length + '\uE001';
      canonicals.push(entry.canonical);
      const re = aliasRegex(entry.alias, entry.caseInsensitive, entry.wholePhrase);
      if (entry.wholePhrase) {
        out = out.replace(re, (match, prefix) => prefix + placeholder);
      } else {
        out = out.replace(re, () => placeholder);
      }
    }

    return out.replace(/\uE000(\d+)\uE001/g, (match, index) => {
      const canonical = canonicals[Number(index)];
      return canonical === undefined ? match : canonical;
    });
  }

  return {
    SCHEMA_VERSION,
    DEFAULT_CONTEXT,
    defaultGlossary,
    normalizeGlossary,
    getWorkProfile,
    applyCorrections,
    // Exposed for tests and future provider adapters.
    aliasRegex,
    clone
  };
});
