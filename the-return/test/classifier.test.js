/*
 * Headless checks for The Silent Read. Run: node the-return/test/classifier.test.js
 * Verifies the classifier routes representative dumps to the right Default
 * Doorway and that the Wedge attached to each read is the correct cross-centre
 * prompt. No framework — exits non-zero on any failure.
 */
'use strict';
var SR = require('../classifier.js');

var cases = [
  {
    name: 'Head — analytical / predictive / risk',
    text: "I keep running the numbers and analyzing every option. What if the forecast is wrong? I'm not sure which decision to make and the risk feels huge.",
    doorway: 'HEAD', wedgeTo: 'GUT', responseType: 'physical-action'
  },
  {
    name: 'Heart — relational / status / feeling',
    text: "I feel like my colleague doesn't respect me. After that argument with my partner I feel rejected and left out, like no one appreciates what I do.",
    doorway: 'HEART', wedgeTo: 'GUT', responseType: 'physical-action'
  },
  {
    name: 'Gut — barrier / anger / push-through',
    text: "I'm completely stuck. I keep trying to push through but I just hit a wall. So frustrated and exhausted, my chest is tight and I'm sick of wasting time.",
    doorway: 'GUT', wedgeTo: 'HEAD', responseType: 'structural-risk'
  },
  {
    name: 'Gut — caps + exclamation intensity',
    text: "PISSED OFF!! nothing is moving, total bottleneck, can't move forward.",
    doorway: 'GUT', wedgeTo: 'HEAD', responseType: 'structural-risk'
  },
  {
    name: 'Empty dump falls back to Head',
    text: "",
    doorway: 'HEAD', wedgeTo: 'GUT', responseType: 'physical-action'
  }
];

// The two verbatim prompts pinned by the spec.
var SPEC_HEAD = 'You have mapped the logic. Now, where does this exact friction hit the ground? Add a physical action node.';
var SPEC_GUT = 'You have mapped the impact. Now, what is the predictive simulation if this fails? Add a structural risk node.';

var failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('  ✗ ' + msg); } }

cases.forEach(function (c) {
  var r = SR.classify(c.text);
  var ok = r.doorway === c.doorway && r.wedge.to === c.wedgeTo && r.wedge.responseType === c.responseType;
  console.log((ok ? '✓' : '✗') + ' ' + c.name +
    '  → ' + r.doorway + ' wedge→' + r.wedge.to +
    '  [HEAD ' + r.scores.HEAD + ' · HEART ' + r.scores.HEART + ' · GUT ' + r.scores.GUT +
    ' · conf ' + r.confidence + ']');
  check(r.doorway === c.doorway, c.name + ': expected doorway ' + c.doorway + ', got ' + r.doorway);
  check(r.wedge.to === c.wedgeTo, c.name + ': expected wedge→' + c.wedgeTo + ', got ' + r.wedge.to);
  check(r.wedge.responseType === c.responseType, c.name + ': expected responseType ' + c.responseType);
});

// Pin the two spec-mandated prompt strings exactly.
check(SR.WEDGES.HEAD.prompt === SPEC_HEAD, 'HEAD wedge prompt must match spec verbatim');
check(SR.WEDGES.GUT.prompt === SPEC_GUT, 'GUT wedge prompt must match spec verbatim');
check(SR.WEDGES.HEART.to === 'GUT', 'HEART must wedge to GUT (body / proving ground)');

console.log('');
if (failures === 0) {
  console.log('PASS — all ' + cases.length + ' reads + 3 wedge assertions correct.');
  process.exit(0);
} else {
  console.log('FAIL — ' + failures + ' assertion(s) failed.');
  process.exit(1);
}
