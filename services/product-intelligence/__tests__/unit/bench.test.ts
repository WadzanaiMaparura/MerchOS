import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCURACY_FAIL_CAP, measurements, scoreCase } from '../../bench/checks';
import { parseJudge } from '../../bench/judge';
import { loadSource } from '../../bench/source';
import { parseReviews, renderScorecard, reviewTemplate, summarise, type RunRecord } from '../../bench/scorecard';
import type { BenchCase, BenchOutput } from '../../bench/types';

const EXAMPLES = join(__dirname, '../../bench/cases/examples');

const mug: BenchCase = {
  id: 'mug',
  label: 'Mug',
  marketplace: 'takealot',
  source: {
    kind: 'manual',
    title: 'Ceramic Coffee Mug 350ml',
    brand: 'Example Home',
    description: 'Matte black ceramic mug. Holds 350 ml. Comfortable handle.',
    attributes: { Material: 'Ceramic', Capacity: '350 ml', Colour: 'Matte black' },
  },
  expect: { category: ['Mugs'], requiredAttributes: ['Material', 'Capacity'], facts: ['350 ml'], mustNotSay: ['set of'] },
};
const source = 'Ceramic Coffee Mug 350ml\nMatte black ceramic mug. Holds 350 ml. Comfortable handle.\nExample Home\nMaterial Ceramic\nCapacity 350 ml\nColour Matte black';

const good: BenchOutput = {
  caseId: 'mug',
  productData: {},
  title: 'Example Home Ceramic Coffee Mug 350 ml Matte Black',
  bullets: ['Holds 350 ml of coffee or tea', 'Ceramic with a matte black finish', 'Comfortable handle', 'Single mug', 'Matte black colour'],
  description: Array.from({ length: 90 }, (_, i) => `w${i}`).join(' ') + ' ceramic mug that holds 350 ml.',
  attributes: [
    { key: 'Material', value: 'Ceramic', confidence: 0.9 },
    { key: 'Capacity', value: '350 ml', confidence: 0.9 },
    { key: 'Colour', value: 'Matte black', confidence: 0.9 },
  ],
  categories: [{ path: ['Home', 'Kitchen', 'Mugs'], confidence: 0.9 }],
  errors: [],
  modelIds: ['m'],
  latencyMs: 1,
};

describe('bench checks', () => {
  it('a clean listing scores 100', () => {
    const s = scoreCase(mug, good, source);
    expect(s.findings).toEqual([]);
    expect(s.score).toBe(100);
  });

  it('reads measurements the way sellers write them', () => {
    expect(measurements('Holds 350ml, 1,5 L jug, 2.4 GHz, 15.6 inch, 2200 W')).toEqual(['350ml', '1.5l', '2.4ghz', '15.6inch', '2200w']);
  });

  it('an invented size or a risky claim is an accuracy failure and caps the score', () => {
    const s = scoreCase(mug, { ...good, bullets: [...good.bullets!.slice(0, 4), 'Dishwasher safe, holds 500 ml'] }, source);
    const msgs = s.findings.filter((f) => f.area === 'accuracy').map((f) => f.message);
    expect(msgs).toEqual(expect.arrayContaining([expect.stringContaining('"500ml"'), expect.stringContaining('dishwasher safe')]));
    expect(s.score).toBeLessThanOrEqual(ACCURACY_FAIL_CAP);
  });

  it('missing required attributes, few bullets, short description and the wrong category are reported', () => {
    const s = scoreCase(
      mug,
      { ...good, bullets: ['Holds 350 ml'], description: 'Ceramic mug, 350 ml.', attributes: [good.attributes![0]!], categories: [{ path: ['Garden'], confidence: 0.5 }] },
      source,
    );
    const m = s.findings.map((f) => `${f.area}:${f.level}:${f.message}`);
    expect(m).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^completeness:fail:Required attribute missing: Capacity/),
        expect.stringMatching(/^completeness:warn:Only 1 bullet/),
        expect.stringMatching(/^completeness:warn:Description is short/),
        expect.stringMatching(/^category:fail:Wrong category: Garden/),
      ]),
    );
  });

  it('marketplace rules: prices, links, sales wording, shouting, restricted terms', () => {
    const s = scoreCase(mug, { ...good, title: 'BEST Mug, only R199, free shipping at www.shop.co.za!', bullets: ['Guaranteed to please', ...good.bullets!.slice(1)] }, source);
    const m = s.findings.filter((f) => f.area === 'rules').map((f) => f.message).join(' | ');
    expect(m).toContain('mentions a price');
    expect(m).toContain('link, email or phone');
    expect(m).toContain('sales wording');
    expect(m).toContain('Restricted term "guaranteed"');
    expect(m).toContain('Title ends with punctuation');
  });

  it('language: US spelling, stock phrases, duplicate bullets', () => {
    const s = scoreCase(
      mug,
      { ...good, description: good.description + ' Elevate your mornings and unleash the color. Look no further.', bullets: ['Same bullet', 'Same bullet!', ...good.bullets!.slice(2)] },
      source,
    );
    const m = s.findings.filter((f) => f.area === 'language').map((f) => f.message).join(' | ');
    expect(m).toContain('US spelling "color"');
    expect(m).toContain('Sounds machine-written');
    expect(m).toContain('Two bullet points say the same thing');
  });

  it('found by the first live run: "7 litre" from "1.7 litre" is caught, a correct cm conversion is not, "secure" is not "cure"', () => {
    const kettleSrc = 'Cordless kettle 1.7L, 2200 W';
    const k = scoreCase({ ...mug, expect: {} }, { ...good, bullets: ['7 litre capacity for many cups', ...good.bullets!.slice(1)] }, kettleSrc + '\n' + source);
    expect(k.findings.some((f) => f.message.startsWith('"7l" is not in the product information'))).toBe(true);
    const bag = scoreCase({ ...mug, expect: {} }, { ...good, bullets: ['Fits laptops up to 15.6 inch (39.62 cm)', ...good.bullets!.slice(1)] }, 'Laptop sleeve 15.6 inch\n' + source);
    expect(bag.findings.filter((f) => f.area === 'accuracy')).toEqual([]);
    const secure = scoreCase(mug, { ...good, bullets: ['A secure, comfortable grip', ...good.bullets!.slice(1)] }, source);
    expect(secure.findings.filter((f) => f.area === 'rules')).toEqual([]);
  });

  it('a step that failed counts as a completeness problem; no category expectation means it is not scored', () => {
    const s = scoreCase({ ...mug, expect: {} }, { ...good, errors: [{ step: 'Bullets', message: 'Bedrock unavailable' }] }, source);
    expect(s.byArea.category).toBeNull();
    expect(s.findings.some((f) => f.message === 'Bullets failed: Bedrock unavailable')).toBe(true);
  });

  it('the cross-check answer is read safely', () => {
    expect(parseJudge('Here: {"wrong":[{"statement":"Holds 500 ml","why":"source says 350 ml"}],"unsupported":[{"statement":"Comes with a gift box"}]}')).toEqual([
      { area: 'accuracy', level: 'fail', message: 'Cross-check, wrong: "Holds 500 ml" (source says 350 ml)' },
      { area: 'accuracy', level: 'warn', message: 'Cross-check, not in the product information: "Comes with a gift box"' },
    ]);
    expect(parseJudge('no json')).toEqual([{ area: 'accuracy', level: 'warn', message: 'Cross-check gave no readable answer' }]);
  });
});

describe('bench sources', () => {
  it('a supplier CSV row and a saved product page become product data like an import', () => {
    const kettle = loadSource({ id: 'k', label: 'k', source: { kind: 'csv', file: 'supplier.csv', row: 1 } }, join(EXAMPLES, 'kettle.json'));
    expect(kettle.productData).toMatchObject({ name: 'Cordless Electric Kettle 1.7L Stainless Steel', brand: 'Example Electric' });
    expect(kettle.sourceText).toContain('2200 W');

    const bag = loadSource({ id: 'b', label: 'b', source: { kind: 'html', file: 'backpack.html', url: 'https://supplier.example.com/x' } }, join(EXAMPLES, 'backpack.json'));
    expect(bag.productData).toMatchObject({ name: 'Laptop Backpack 25L Grey', brand: 'Example Outdoor' });
    expect(bag.productData.description).toContain('15.6 inch');
  });

  it('typed-in data is mapped like the product service (no blanks, attributes as text)', () => {
    const r = loadSource({ id: 'x', label: 'x', source: { kind: 'manual', title: '  Mug ', description: '', attributes: { Pack: 1, Empty: '' } } }, 'x.json');
    expect(r.productData).toEqual({ name: 'Mug', attributes: { Pack: '1' } });
  });
});

describe('scorecard', () => {
  const run: RunRecord = {
    runId: '20261201-0900',
    startedAt: '2026-12-01T07:00:00.000Z',
    label: 'Baseline',
    judge: false,
    cases: [mug, { ...mug, id: 'mug2', label: 'Mug <2>' }],
    outputs: [good, { ...good, caseId: 'mug2', bullets: ['Holds 500 ml'] }],
    scores: [scoreCase(mug, good, source), scoreCase(mug, { ...good, caseId: 'mug2', bullets: ['Holds 500 ml'] }, source)],
  };
  run.scores[1]!.caseId = 'mug2';

  it('summarises, lists the common problems and your verdicts', () => {
    const reviews = parseReviews('id,product,score,verdict,note\nmug,Mug,100,good,\n"mug2","Mug <2>",50,BAD,"Wrong size, ""500 ml"""\n');
    expect(reviews).toEqual([
      { caseId: 'mug', verdict: 'good' },
      { caseId: 'mug2', verdict: 'bad', note: 'Wrong size, "500 ml"' },
    ]);
    const s = summarise(run, reviews);
    expect(s.cleanPct).toBe(50);
    expect(s.reviews).toEqual({ good: 1, fix: 0, bad: 1, pending: 0 });
    expect(s.topProblems[0]!.count).toBe(1);
  });

  it('renders an escaped page, weakest product first, with the change since the last run', () => {
    const html = renderScorecard(run, [], { ...run, runId: '20261130-0900', label: 'Before', scores: run.scores.map((x) => ({ ...x, score: x.score - 10 })) });
    expect(html).toContain('Mug &lt;2&gt;');
    expect(html).not.toContain('Mug <2>');
    expect(html.indexOf('id="mug2"')).toBeLessThan(html.indexOf('id="mug"'));
    expect(html).toContain('compared with Before');
    expect(html).toContain('+10');
    expect(html).not.toMatch(/\u2014/);
  });

  it('the review sheet keeps verdicts already filled in', () => {
    const csv = reviewTemplate(run, [{ caseId: 'mug', verdict: 'fix', note: 'Title too long, cut' }]);
    expect(csv.split('\n')[1]).toBe('mug,Mug,100,fix,"Title too long, cut"');
  });
});
