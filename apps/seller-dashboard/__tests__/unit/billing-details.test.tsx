/**
 * BillingDetailsCard: the form where a seller sets the company details printed on
 * their invoices. Checks hydration from the saved profile, that the payload
 * leaves blanks out (PUT semantics), and the error/success states.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mutate = vi.fn();
let profileState: { data: unknown; isLoading: boolean; isError: boolean } = {
  data: null,
  isLoading: false,
  isError: false,
};
let saveState: { isPending: boolean; isError: boolean; error: { message: string } | null } = {
  isPending: false,
  isError: false,
  error: null,
};
vi.mock('@merch-os/api-client', () => ({
  useBillingProfile: () => profileState,
  useUpdateBillingProfile: () => ({ mutate, ...saveState }),
}));

import { BillingDetailsCard, toProfileInput } from '../../app/(dashboard)/billing/BillingDetailsCard';

beforeEach(() => {
  vi.clearAllMocks();
  profileState = { data: null, isLoading: false, isError: false };
  saveState = { isPending: false, isError: false, error: null };
});

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('toProfileInput', () => {
  it('trims, drops blanks and splits the address into trimmed non-empty lines', () => {
    expect(
      toProfileInput({
        companyName: '  Acme (Pty) Ltd ',
        registrationNumber: '   ',
        vatNumber: '4123456789',
        email: '',
        address: ' 1 Main St \n\n  Sandton\r\n',
      })
    ).toEqual({
      companyName: 'Acme (Pty) Ltd',
      vatNumber: '4123456789',
      addressLines: ['1 Main St', 'Sandton'],
    });
  });

  it('with only a name, sends only the name', () => {
    expect(
      toProfileInput({ companyName: 'Solo', registrationNumber: '', vatNumber: '', email: '', address: '' })
    ).toEqual({ companyName: 'Solo' });
  });
});

describe('BillingDetailsCard', () => {
  it('cannot be saved until a company name is entered', () => {
    render(<BillingDetailsCard />);
    const save = screen.getByRole('button', { name: /save billing details/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    type(/company or business name/i, 'Acme');
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it('fills the form from the saved profile', () => {
    profileState = {
      data: {
        companyName: 'Acme (Pty) Ltd',
        vatNumber: '4123456789',
        email: 'ap@acme.example',
        addressLines: ['1 Main St', 'Sandton'],
        updatedAt: 'x',
      },
      isLoading: false,
      isError: false,
    };
    render(<BillingDetailsCard />);
    expect((screen.getByLabelText(/company or business name/i) as HTMLInputElement).value).toBe('Acme (Pty) Ltd');
    expect((screen.getByLabelText(/vat number/i) as HTMLInputElement).value).toBe('4123456789');
    expect((screen.getByLabelText(/address/i) as HTMLTextAreaElement).value).toBe('1 Main St\nSandton');
  });

  it('submits the cleaned payload', () => {
    render(<BillingDetailsCard />);
    type(/company or business name/i, '  Acme ');
    type(/address/i, '1 Main St\n\nSandton');
    fireEvent.click(screen.getByRole('button', { name: /save billing details/i }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({ companyName: 'Acme', addressLines: ['1 Main St', 'Sandton'] });
  });

  it('does not submit when the name is only whitespace', () => {
    render(<BillingDetailsCard />);
    type(/company or business name/i, '   ');
    fireEvent.submit(screen.getByRole('form', { name: /billing details/i }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('confirms a successful save, announced to assistive tech', async () => {
    mutate.mockImplementation((_input, opts) => opts.onSuccess());
    render(<BillingDetailsCard />);
    type(/company or business name/i, 'Acme');
    fireEvent.click(screen.getByRole('button', { name: /save billing details/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/saved/i));
  });

  it('shows the server error', () => {
    saveState = { isPending: false, isError: true, error: { message: 'Enter a valid VAT number' } };
    render(<BillingDetailsCard />);
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid VAT number');
  });

  it('warns but stays usable when the profile fails to load', () => {
    profileState = { data: undefined, isLoading: false, isError: true };
    render(<BillingDetailsCard />);
    expect(screen.getByText(/couldn.t load your billing details/i)).toBeTruthy();
    expect((screen.getByLabelText(/company or business name/i) as HTMLInputElement).disabled).toBe(false);
  });

  it('disables inputs while the profile is loading', () => {
    profileState = { data: undefined, isLoading: true, isError: false };
    render(<BillingDetailsCard />);
    expect((screen.getByLabelText(/company or business name/i) as HTMLInputElement).disabled).toBe(true);
  });

  it('shows "Saving…" and blocks double submit while pending', () => {
    saveState = { isPending: true, isError: false, error: null };
    render(<BillingDetailsCard />);
    type(/company or business name/i, 'Acme');
    const btn = screen.getByRole('button', { name: /saving/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
