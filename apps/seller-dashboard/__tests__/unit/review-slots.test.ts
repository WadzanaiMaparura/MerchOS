import { describe, expect, it } from 'vitest';
import { fillSlots, initials } from '../../app/components/engagement/reviews';

const placeholders = ['A', 'B', 'C', 'D'];
const review = (n: number) => ({ reviewId: `r${n}`, name: `Seller ${n}`, label: '', quote: 'q', rating: 5 });

describe('approved reviews fill the placeholder slots', () => {
  it('no reviews: the placeholders stay exactly as they are', () => {
    expect(fillSlots(placeholders, [], (r) => r.name)).toEqual(placeholders);
  });

  it('the first approved review takes slot 1, the rest stay placeholders', () => {
    expect(fillSlots(placeholders, [review(1)], (r) => r.name)).toEqual(['Seller 1', 'B', 'C', 'D']);
    expect(fillSlots(placeholders, [review(1), review(2)], (r) => r.name)).toEqual(['Seller 1', 'Seller 2', 'C', 'D']);
  });

  it('never adds slots', () => {
    const many = [1, 2, 3, 4, 5, 6].map(review);
    expect(fillSlots(placeholders, many, (r) => r.name)).toHaveLength(4);
  });

  it('initials for real reviews (no photo)', () => {
    expect(initials('Thandi K.')).toBe('TK');
    expect(initials('sipho')).toBe('S');
    expect(initials('')).toBe('M');
  });
});
