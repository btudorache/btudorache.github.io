// The owl's flat state at every figure of Díaz's diagram, as JSON, for check-owl.py:
// the paper as the folder sees it after the stages that figure follows (fold.js flatState).
//
//     node tools/owl-states.mjs

import { flatState, validate } from '../fold.js';
import { buildModel, figure } from '../owl-model.js';

const model = buildModel({ tessellate: false });
const figures = Object.fromEntries(Object.entries(figure).map(([n, k]) => [n, {
    stages: k,
    pieces: flatState(model, k).map(p => ({ side: p.side, pts: p.pts })),
}]));
console.log(JSON.stringify({ figures, problems: validate(model) }));
