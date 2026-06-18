/*
 * THE RETURN — The Silent Read
 * -----------------------------------------------------------------------------
 * The diagnostic core of the Agnostic Node Canvas. Pure, deterministic,
 * inspectable. No network, no LLM, no DOM. Given raw friction text it returns
 * the operator's "Default Doorway" (HEAD / HEART / GUT) plus the Wedge that
 * forces them out of it.
 *
 * This module is the single source of truth for the read. It is mirrored
 * verbatim inside index.html's inline <script> so the prototype can run from a
 * single self-contained file. If you change one, change the other.
 *
 * Usable in the browser (attaches window.SilentRead) and in Node
 * (module.exports) so the logic can be unit-tested headlessly.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (root) { root.SilentRead = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // The Wedge map. Each Default Doorway is forced into a DIFFERENT processing
  // centre. HEAD<->GUT is the given abstract<->concrete swap. HEART is routed
  // to GUT (the body / proving ground) because relational narrative is the most
  // fakeable read; the wedge always moves toward provable reality, never into
  // the emotional atmosphere, so HEART is never a destination. Retune freely.
  // ---------------------------------------------------------------------------
  var WEDGES = {
    HEAD: {
      from: 'HEAD', to: 'GUT',
      label: 'Head', gloss: 'mapping · logic · prediction',
      prompt: 'You have mapped the logic. Now, where does this exact friction hit the ground? Add a physical action node.',
      responseType: 'physical-action', responseLabel: 'Physical Action',
      cta: 'Add physical action node'
    },
    GUT: {
      from: 'GUT', to: 'HEAD',
      label: 'Gut', gloss: 'impact · drive · barrier',
      prompt: 'You have mapped the impact. Now, what is the predictive simulation if this fails? Add a structural risk node.',
      responseType: 'structural-risk', responseLabel: 'Structural Risk',
      cta: 'Add structural risk node'
    },
    HEART: {
      from: 'HEART', to: 'GUT',
      label: 'Heart', gloss: 'resonance · relation · status',
      prompt: 'You have mapped the relational charge. Now, where does this friction land in the body — and what single physical action can your hands take? Add a physical action node.',
      responseType: 'physical-action', responseLabel: 'Physical Action',
      cta: 'Add physical action node'
    }
  };

  // ---------------------------------------------------------------------------
  // Lexicons. Single-token terms, exact match (variants listed explicitly to
  // keep precision high). Weights: ~1 ordinary signal, ~2 strong signal.
  // ---------------------------------------------------------------------------
  var LEXICONS = {
    // analytical / predictive / anxious / variables / risk
    HEAD: {
      'think': 1, 'thinking': 1, 'thought': 1, 'thoughts': 1, 'overthink': 2, 'overthinking': 2,
      'analyze': 2, 'analyse': 2, 'analyzing': 2, 'analysing': 2, 'analysis': 2, 'analytical': 2,
      'logic': 2, 'logical': 2, 'rational': 1, 'reason': 1, 'reasons': 1, 'figure': 1,
      'plan': 1.5, 'planning': 1.5, 'plans': 1, 'strategy': 1.5, 'strategize': 2, 'predict': 2,
      'prediction': 2, 'predictive': 2, 'forecast': 2, 'simulate': 2, 'simulation': 2,
      'scenario': 2, 'scenarios': 2, 'variable': 2, 'variables': 2, 'option': 1.5, 'options': 1.5,
      'risk': 2, 'risks': 2, 'risky': 1.5, 'uncertain': 2, 'uncertainty': 2, 'unsure': 1.5,
      'decide': 1.5, 'decision': 1.5, 'decisions': 1.5, 'calculate': 1.5, 'probability': 2,
      'odds': 1.5, 'contingency': 2, 'model': 1, 'map': 1.5, 'mapping': 1.5, 'framework': 1.5,
      'organize': 1.5, 'organise': 1.5, 'prioritize': 1.5, 'prioritise': 1.5, 'timeline': 1.5,
      'deadline': 1, 'schedule': 1, 'data': 1.5, 'numbers': 1, 'metrics': 1.5, 'worry': 1.5,
      'worried': 1.5, 'worrying': 1.5, 'anxious': 2, 'anxiety': 2, 'nervous': 1.5, 'spiral': 1.5,
      'spiraling': 1.5, 'spiralling': 1.5, 'ruminate': 2, 'ruminating': 2, 'complexity': 1.5,
      'complicated': 1.5, 'confusing': 1.5, 'confused': 1.5, 'understand': 1, 'knowledge': 1,
      'information': 1, 'consider': 1, 'considering': 1, 'evaluate': 1.5, 'assess': 1.5
    },
    // relationships / feelings / status / conflict-with-others / atmosphere
    HEART: {
      'feel': 1.5, 'feeling': 1.5, 'feelings': 1.5, 'felt': 1.5, 'emotion': 1.5, 'emotions': 1.5,
      'emotional': 1.5, 'hurt': 1.5, 'sad': 1.5, 'lonely': 2, 'alone': 1.5, 'love': 2, 'loved': 1.5,
      'unloved': 2, 'care': 1.5, 'cares': 1.5, 'caring': 1.5, 'friend': 2, 'friends': 2,
      'friendship': 2, 'family': 2, 'partner': 2, 'wife': 2, 'husband': 2, 'boyfriend': 2,
      'girlfriend': 2, 'mother': 1.5, 'father': 1.5, 'mom': 1.5, 'mum': 1.5, 'dad': 1.5,
      'parent': 1.5, 'parents': 1.5, 'boss': 1.5, 'manager': 1.5, 'colleague': 2, 'colleagues': 2,
      'coworker': 2, 'coworkers': 2, 'team': 1.5, 'client': 1.5, 'clients': 1.5, 'relationship': 2,
      'relationships': 2, 'connection': 2, 'connect': 1.5, 'disconnected': 2, 'trust': 1.5,
      'betray': 2, 'betrayed': 2, 'rejected': 2, 'rejection': 2, 'abandon': 2, 'abandoned': 2,
      'ashamed': 2, 'shame': 2, 'guilt': 1.5, 'guilty': 1.5, 'embarrass': 2, 'embarrassed': 2,
      'humiliated': 2, 'judged': 2, 'judge': 1.5, 'judgment': 1.5, 'judgement': 1.5, 'approval': 2,
      'respect': 1.5, 'respected': 1.5, 'disrespect': 2, 'disrespected': 2, 'status': 2,
      'reputation': 2, 'belong': 2, 'belonging': 2, 'excluded': 2, 'ignored': 2, 'unseen': 2,
      'unheard': 2, 'dismissed': 1.5, 'appreciate': 1.5, 'appreciated': 1.5, 'unappreciated': 2,
      'resent': 2, 'resentment': 2, 'resentful': 2, 'disappointed': 1.5, 'disappoint': 1.5,
      'awkward': 1.5, 'vibe': 2, 'mood': 1.5
    },
    // physical roadblocks / action / anger / inefficiency / push-through
    GUT: {
      'stuck': 2, 'blocked': 2, 'block': 1.5, 'barrier': 2, 'barriers': 2, 'wall': 1.5,
      'obstacle': 1.5, 'obstacles': 1.5, 'push': 1.5, 'pushing': 1.5, 'force': 1.5, 'forcing': 1.5,
      'grind': 2, 'grinding': 2, 'slog': 2, 'drag': 1.5, 'dragging': 1.5, 'exhausted': 2,
      'exhausting': 2, 'tired': 1.5, 'drained': 2, 'draining': 2, 'fatigue': 1.5, 'burnout': 2,
      'sluggish': 2, 'heavy': 1.5, 'slow': 1.5, 'stall': 1.5, 'stalled': 2, 'frozen': 2,
      'paralyzed': 2, 'paralysed': 2, 'paralysis': 2, 'restless': 1.5, 'antsy': 1.5, 'body': 1.5,
      'gut': 1.5, 'stomach': 1.5, 'chest': 1.5, 'jaw': 1.5, 'shoulders': 1.5, 'tense': 1.5,
      'tight': 1.5, 'clench': 2, 'clenched': 2, 'knot': 1.5, 'pain': 1.5, 'ache': 1.5, 'sweat': 1.5,
      'angry': 2, 'anger': 2, 'mad': 1.5, 'rage': 2, 'furious': 2, 'pissed': 2, 'frustrated': 2,
      'frustration': 2, 'frustrating': 2, 'irritated': 1.5, 'annoyed': 1.5, 'annoying': 1.5,
      'inefficient': 2, 'inefficiency': 2, 'waste': 1.5, 'wasting': 1.5, 'bottleneck': 2,
      'momentum': 1.5, 'action': 1.5, 'execute': 1.5, 'ship': 1.5, 'urgent': 1.5, 'overwhelmed': 1.5
    }
  };

  // Multi-word phrases, matched on the lowercased string with rough boundaries.
  var PHRASES = {
    HEAD: {
      'what if': 3, 'plan b': 2, 'figure out': 2, 'figure it out': 2, 'racing thoughts': 2,
      "don't know": 1.5, 'do not know': 1.5, 'not sure': 1.5, 'going to': 0.6, 'worst case': 2,
      'second guess': 2, 'second-guess': 2, 'what could': 1.2, 'play out': 1.2
    },
    HEART: {
      'left out': 2, 'let down': 1.5, 'looked down': 2, 'looking down': 2, 'cut off': 1.2,
      'falling out': 1.5, 'they think': 1.5, 'no one': 1.2, 'nobody': 1.2, 'pushed away': 1.5
    },
    GUT: {
      'push through': 2.5, 'pushing through': 2.5, "can't move": 2.5, 'cannot move': 2.5,
      'fed up': 2, 'pissed off': 2.5, 'sick of': 1.5, 'had enough': 2, 'get it done': 2,
      'take action': 2, 'waste of time': 2, 'spinning my wheels': 2.5, 'hit a wall': 2.5,
      'burned out': 2, 'burnt out': 2, 'dead weight': 1.5
    }
  };

  var PEOPLE = ['you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'they',
    'them', 'their', 'theirs', 'we', 'us', 'our', 'everyone', 'someone', 'somebody', 'people'];
  var MODALS = ['will', 'would', 'could', 'should', 'might', 'may', 'if', 'whether', 'perhaps',
    'maybe', 'suppose', 'probably', 'possibly'];

  function tokenize(s) { return (s.toLowerCase().match(/[a-z']+/g) || []); }

  function countPhrase(lower, phrase) {
    var esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(^|[^a-z])' + esc + '(?![a-z])', 'g');
    var c = 0;
    while (re.exec(lower) !== null) { c++; if (c > 5) { break; } }
    return c;
  }

  function classify(text) {
    text = (text == null) ? '' : String(text);
    var lower = text.toLowerCase();
    var tokens = tokenize(text);
    var counts = Object.create(null);
    for (var i = 0; i < tokens.length; i++) { counts[tokens[i]] = (counts[tokens[i]] || 0) + 1; }

    var scores = { HEAD: 0, HEART: 0, GUT: 0 };
    var matched = { HEAD: [], HEART: [], GUT: [] };
    var centres = ['HEAD', 'HEART', 'GUT'];

    centres.forEach(function (centre) {
      var lex = LEXICONS[centre];
      Object.keys(lex).forEach(function (term) {
        var c = counts[term] || 0;
        if (c > 0) { scores[centre] += lex[term] * Math.min(c, 3); matched[centre].push(term); }
      });
      var ph = PHRASES[centre];
      Object.keys(ph).forEach(function (term) {
        var c = countPhrase(lower, term);
        if (c > 0) { scores[centre] += ph[term] * Math.min(c, 3); matched[centre].push(term); }
      });
    });

    // Sentiment / intensity heuristics (capped so a long rant can't run away).
    var q = (text.match(/\?/g) || []).length;
    var ex = (text.match(/!/g) || []).length;
    var caps = (text.match(/\b[A-Z]{3,}\b/g) || []).length;
    var modalCount = 0, peopleCount = 0, j;
    for (j = 0; j < MODALS.length; j++) { modalCount += counts[MODALS[j]] || 0; }
    for (j = 0; j < PEOPLE.length; j++) { peopleCount += counts[PEOPLE[j]] || 0; }

    var signals = {
      questionMarks: Math.min(q, 3),
      modals: Math.min(modalCount, 4),
      exclaims: Math.min(ex, 3),
      capsWords: Math.min(caps, 3),
      peopleRefs: Math.min(peopleCount, 6)
    };
    scores.HEAD += signals.questionMarks * 1.0 + signals.modals * 0.5;
    scores.GUT += signals.exclaims * 1.2 + signals.capsWords * 1.0;
    scores.HEART += signals.peopleRefs * 0.5;

    centres.forEach(function (c) { scores[c] = Math.round(scores[c] * 100) / 100; });
    var total = Math.round((scores.HEAD + scores.HEART + scores.GUT) * 100) / 100;

    // Pick the winner. Ties (and a flat / empty dump) resolve to HEAD — an
    // undifferentiated read with no felt or physical charge is "in the head".
    var priority = { HEAD: 3, GUT: 2, HEART: 1 };
    var doorway = 'HEAD', best = -1;
    centres.forEach(function (c) {
      if (scores[c] > best || (scores[c] === best && priority[c] > priority[doorway])) {
        best = scores[c]; doorway = c;
      }
    });
    if (total <= 0) { doorway = 'HEAD'; }

    var confidence = total > 0 ? Math.round((best / total) * 100) / 100 : 0;

    return {
      doorway: doorway,
      scores: scores,
      total: total,
      confidence: confidence,
      signals: signals,
      matched: matched,
      wedge: WEDGES[doorway]
    };
  }

  return { classify: classify, WEDGES: WEDGES, LEXICONS: LEXICONS, PHRASES: PHRASES };
});
