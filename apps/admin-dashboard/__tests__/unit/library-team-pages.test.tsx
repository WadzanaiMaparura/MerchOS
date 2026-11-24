import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let role: string | null = 'Support';
vi.mock('../../hooks/usePlatformRole', () => ({ usePlatformRole: () => ({ platformRole: role, isResolved: true }) }));
vi.mock('../../components/AdminRouteGuard', () => ({ AdminRouteGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../lib/customers', () => ({ ADMIN_API_URL: 'https://admin-api.example' }));

const lib = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
const team = vi.hoisted(() => ({
  unread: vi.fn(), announcements: vi.fn(), markRead: vi.fn(), post: vi.fn(), removeAnnouncement: vi.fn(),
  goals: vi.fn(), createGoal: vi.fn(), removeGoal: vi.fn(), updateProgress: vi.fn(),
  channels: vi.fn(), messages: vi.fn(), sendMessage: vi.fn(), markChannelRead: vi.fn(),
}));
vi.mock('../../lib/team', () => ({ libraryApi: lib, teamApi: team }));

import LibraryPage from '../../app/(dashboard)/library/page';
import TeamPage from '../../app/(dashboard)/team/page';

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const article = {
  articleId: 'a1', title: 'Takealot image rules', category: 'marketplace-rules',
  body: 'Main image on a white background, at least 500px.', pinned: true,
  updatedAt: '2026-11-20T10:00:00Z', updatedByEmail: 'admin@merchos.co.za',
};
const categories = [
  { id: 'marketplace-rules', label: 'Marketplace rules', count: 1 },
  { id: 'policies', label: 'Policies', count: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  role = 'Support';
  lib.list.mockResolvedValue({ articles: [article], categories, total: 1 });
  lib.get.mockResolvedValue(article);
  lib.create.mockResolvedValue({ article: { ...article, articleId: 'a2' } });
  team.unread.mockResolvedValue({ announcements: 1, chat: 2, total: 3 });
  team.announcements.mockResolvedValue([
    { announcementId: 'n1', title: 'Payments go live soon', body: 'Read the billing article.', createdAt: '2026-11-22T08:00:00Z', createdByEmail: 'admin@merchos.co.za', read: false, readBy: 0, audience: 2 },
  ]);
  team.markRead.mockResolvedValue({});
  team.post.mockResolvedValue({});
  team.goals.mockResolvedValue({
    month: '2026-11',
    goals: [
      { goalId: 'g1', title: 'Onboard 20 new sellers', month: '2026-11', target: 20, kind: 'auto', metric: 'new_sellers', metricLabel: 'New sellers', progress: 5, updatedAt: '2026-11-22T08:00:00Z', canUpdate: false },
      { goalId: 'g2', title: 'Write 10 library articles', month: '2026-11', target: 10, kind: 'manual', progress: 3, ownerId: 'u2', ownerEmail: 'info@merchos.co.za', updatedAt: '2026-11-22T08:00:00Z', canUpdate: true },
    ],
    metrics: [{ id: 'new_sellers', label: 'New sellers' }],
    staff: [{ id: 'u2', email: 'info@merchos.co.za', role: 'Support' }],
  });
  team.updateProgress.mockResolvedValue({});
  team.channels.mockResolvedValue([
    { channel: 'everyone', label: '# everyone', unread: 0 },
    { channel: 'dm#u1#u2', label: 'admin@merchos.co.za', withUserId: 'u1', unread: 2 },
  ]);
  team.messages.mockResolvedValue([
    { messageId: 'm1', channel: 'everyone', from: 'u1', fromEmail: 'admin@merchos.co.za', text: 'Morning team', at: '2026-11-23T07:00:00Z', mine: false },
  ]);
  team.markChannelRead.mockResolvedValue({});
  team.sendMessage.mockResolvedValue({ messageId: 'm2', channel: 'everyone', from: 'u2', fromEmail: 'info@merchos.co.za', text: 'Hi', at: '2026-11-23T07:01:00Z', mine: true });
});

describe('Library page', () => {
  it('Support reads articles but cannot write', async () => {
    const user = userEvent.setup();
    wrap(<LibraryPage />);
    expect(await screen.findByText('Takealot image rules')).toBeTruthy();
    expect(screen.getByText('Marketplace rules (1)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New article' })).toBeNull();
    await user.click(screen.getByText('Takealot image rules'));
    expect(await screen.findByRole('heading', { name: 'Takealot image rules' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('filters by category', async () => {
    const user = userEvent.setup();
    wrap(<LibraryPage />);
    await user.click(await screen.findByRole('button', { name: 'Policies (0)' }));
    await waitFor(() => expect(lib.list).toHaveBeenLastCalledWith('', 'policies'));
  });

  it('Admin writes a new article', async () => {
    role = 'Admin';
    const user = userEvent.setup();
    wrap(<LibraryPage />);
    await user.click(await screen.findByRole('button', { name: 'New article' }));
    await user.type(screen.getByLabelText('Title'), 'Refund policy');
    await user.selectOptions(screen.getByLabelText('Category'), 'policies');
    await user.type(screen.getByLabelText(/^Article/), 'Refunds within 7 days.');
    await user.click(screen.getByRole('button', { name: 'Save article' }));
    await waitFor(() =>
      expect(lib.create).toHaveBeenCalledWith({ title: 'Refund policy', category: 'policies', body: 'Refunds within 7 days.', pinned: false }),
    );
  });
});

describe('Team page', () => {
  it('shows unread counts and marks an announcement read', async () => {
    const user = userEvent.setup();
    wrap(<TeamPage />);
    expect(await screen.findByText('Payments go live soon')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New announcement' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: /Announcements 1 unread/ })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Mark as read' }));
    await waitFor(() => expect(team.markRead).toHaveBeenCalledWith('n1'));
  });

  it('Admin posts an announcement', async () => {
    role = 'Admin';
    const user = userEvent.setup();
    wrap(<TeamPage />);
    await user.click(await screen.findByRole('button', { name: 'New announcement' }));
    await user.type(screen.getByLabelText('Title'), 'Team meeting');
    await user.type(screen.getByLabelText('Message'), 'Friday at 10.');
    await user.click(screen.getByRole('button', { name: 'Post to the team' }));
    await waitFor(() => expect(team.post).toHaveBeenCalledWith('Team meeting', 'Friday at 10.'));
  });

  it('goals: the owner updates progress; auto goals cannot be edited', async () => {
    const user = userEvent.setup();
    wrap(<TeamPage />);
    await user.click(screen.getByRole('button', { name: 'Goals' }));
    expect(await screen.findByText('Onboard 20 new sellers')).toBeTruthy();
    expect(screen.getByText(/Counted automatically: New sellers/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Update progress' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Update progress' }));
    const input = screen.getByLabelText('Progress');
    await user.clear(input);
    await user.type(input, '4');
    await user.type(screen.getByLabelText(/Short status/), 'On track');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(team.updateProgress).toHaveBeenCalledWith('g2', 4, 'On track'));
  });

  it('chat loads messages, marks the channel read and sends', async () => {
    const user = userEvent.setup();
    wrap(<TeamPage />);
    await user.click(screen.getByRole('button', { name: /^Chat/ }));
    expect(await screen.findByText('Morning team')).toBeTruthy();
    await waitFor(() => expect(team.markChannelRead).toHaveBeenCalledWith('everyone', '2026-11-23T07:00:00Z'));
    expect(await screen.findByRole('button', { name: /admin@merchos.co.za 2 unread/ })).toBeTruthy();
    await user.type(screen.getByLabelText('Message'), 'Hi{Enter}');
    await waitFor(() => expect(team.sendMessage).toHaveBeenCalledWith('everyone', 'Hi'));
    expect(await screen.findByText('Hi')).toBeTruthy();
  });
});
