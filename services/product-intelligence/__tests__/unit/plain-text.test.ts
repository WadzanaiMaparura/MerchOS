import { describe, it, expect } from 'vitest';
import { marketplaceName, toPlainText } from '../../services/content-generator';

describe('toPlainText', () => {
  it('removes Markdown marks marketplaces would show literally', () => {
    expect(toPlainText('**Spacious 1.7L Capacity**: boils enough for the family')).toBe(
      'Spacious 1.7L Capacity: boils enough for the family',
    );
    expect(toPlainText('## Overview\nA __great__ `kettle`')).toBe('Overview\nA great kettle');
  });

  it('drops wrapping quotes from a title', () => {
    expect(toPlainText('"Russell Hobbs 1.7L Kettle"')).toBe('Russell Hobbs 1.7L Kettle');
  });
});

describe('marketplaceName', () => {
  it('names the target marketplace in prompts', () => {
    expect(marketplaceName('takealot')).toBe('Takealot');
    expect(marketplaceName(undefined)).toBe('online marketplaces');
  });
});
