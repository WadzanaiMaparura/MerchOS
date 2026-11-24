'use client';

/**
 * Library: rules and things to know, for MerchOS staff. Admin writes and edits
 * articles; Support reads them. Every change is recorded in the Audit log.
 */

import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PermissionRegistry, defaultPermissionConfig } from '@merch-os/rbac';
import { AdminRouteGuard } from '../../../components/AdminRouteGuard';
import { usePlatformRole } from '../../../hooks/usePlatformRole';
import { ADMIN_API_URL } from '../../../lib/customers';
import { libraryApi, type Article, type ArticleInput, type Category } from '../../../lib/team';

const registry = new PermissionRegistry(defaultPermissionConfig);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
const btn =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const btnPrimary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const btnSecondary = `${btn} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
const field = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30';

export default function LibraryPage() {
  return (
    <AdminRouteGuard requiredResource="library">
      {ADMIN_API_URL ? <Library /> : <div className="p-6 text-sm text-gray-600">The Library is not configured for this environment.</div>}
    </AdminRouteGuard>
  );
}

type View = { kind: 'list' } | { kind: 'read'; id: string } | { kind: 'edit'; id?: string };

function Library() {
  const { platformRole } = usePlatformRole();
  const canWrite = !!platformRole && registry.hasPermission(platformRole, 'library', 'update').granted;
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [view, setView] = useState<View>({ kind: 'list' });

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useQuery({ queryKey: ['library', q, category], queryFn: () => libraryApi.list(q, category) });
  const categories = list.data?.categories ?? [];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Library</h1>
          <p className="mt-1 text-sm text-gray-600">Rules and things to know. Staff only.</p>
        </div>
        {canWrite && view.kind !== 'edit' && (
          <button type="button" className={btnPrimary} onClick={() => setView({ kind: 'edit' })}>
            New article
          </button>
        )}
      </div>

      {view.kind === 'edit' ? (
        <Editor id={view.id} categories={categories} onDone={(id) => setView(id ? { kind: 'read', id } : { kind: 'list' })} />
      ) : (
        <>
          <label className="block">
            <span className="sr-only">Search the library</span>
            <input type="search" className={field} value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Search the library, e.g. "Takealot image size"' />
          </label>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
            <nav aria-label="Categories">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Categories</h2>
              <ul className="space-y-0.5 text-sm">
                <CategoryButton label={`All (${list.data?.total ?? 0})`} active={!category} onClick={() => { setCategory(''); setView({ kind: 'list' }); }} />
                {categories.map((c) => (
                  <CategoryButton key={c.id} label={`${c.label} (${c.count})`} active={category === c.id} onClick={() => { setCategory(c.id); setView({ kind: 'list' }); }} />
                ))}
              </ul>
            </nav>
            <div>
              {view.kind === 'read' ? (
                <Reader id={view.id} categories={categories} canWrite={canWrite} onBack={() => setView({ kind: 'list' })} onEdit={() => setView({ kind: 'edit', id: view.id })} />
              ) : (
                <div className="space-y-2">
                  {list.isLoading && <p className="text-sm text-gray-500">Loading…</p>}
                  {list.isError && <p role="alert" className="text-sm text-red-700">{(list.error as Error).message}</p>}
                  {list.data?.articles.length === 0 && (
                    <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-600">
                      {q ? 'No articles match.' : canWrite ? 'No articles yet. Add the first one with "New article".' : 'No articles yet.'}
                    </p>
                  )}
                  {list.data?.articles.map((a) => (
                    <button
                      key={a.articleId}
                      type="button"
                      onClick={() => setView({ kind: 'read', id: a.articleId })}
                      className="block w-full rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                      <span className="block font-semibold text-gray-900">{a.title}</span>
                      <span className="mt-0.5 block line-clamp-2 text-sm text-gray-600">{a.body}</span>
                      <span className="mt-1 block text-xs text-gray-500">
                        {categories.find((c) => c.id === a.category)?.label} · updated {day(a.updatedAt)} by {a.updatedByEmail}
                        {a.pinned && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">Pinned</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CategoryButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? 'true' : undefined}
        onClick={onClick}
        className={`w-full rounded px-2 py-1.5 text-left ${active ? 'bg-blue-50 font-semibold text-blue-800' : 'text-gray-700 hover:bg-gray-100'}`}
      >
        {label}
      </button>
    </li>
  );
}

function Reader({ id, categories, canWrite, onBack, onEdit }: { id: string; categories: Category[]; canWrite: boolean; onBack: () => void; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['library-article', id], queryFn: () => libraryApi.get(id) });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a: Article | undefined = q.data;

  const remove = async () => {
    try {
      await libraryApi.remove(id);
      await queryClient.invalidateQueries({ queryKey: ['library'] });
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.');
    }
  };

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4">
      <button type="button" className="text-sm text-blue-700 underline" onClick={onBack}>Back to the list</button>
      {q.isLoading && <p className="mt-3 text-sm text-gray-500">Loading…</p>}
      {q.isError && <p role="alert" className="mt-3 text-sm text-red-700">{(q.error as Error).message}</p>}
      {a && (
        <>
          <h2 className="mt-3 text-xl font-semibold text-gray-900">{a.title}</h2>
          <p className="mt-1 text-xs text-gray-500">
            {categories.find((c) => c.id === a.category)?.label} · updated {day(a.updatedAt)} by {a.updatedByEmail}
            {a.pinned && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">Pinned</span>}
          </p>
          <div className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-900">{a.body}</div>
          {canWrite && (
            <div className="mt-6 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
              <button type="button" className={btnSecondary} onClick={onEdit}>Edit</button>
              {confirm ? (
                <span className="flex items-center gap-2 text-sm text-red-800">
                  Delete this article?
                  <button type="button" className={`${btn} bg-red-600 text-white hover:bg-red-700`} onClick={() => void remove()}>Yes, delete</button>
                  <button type="button" className={btnSecondary} onClick={() => setConfirm(false)}>Cancel</button>
                </span>
              ) : (
                <button type="button" className={`${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`} onClick={() => setConfirm(true)}>Delete</button>
              )}
            </div>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        </>
      )}
    </article>
  );
}

function Editor({ id, categories, onDone }: { id?: string | undefined; categories: Category[]; onDone: (id?: string) => void }) {
  const queryClient = useQueryClient();
  const existing = useQuery({ queryKey: ['library-article', id], queryFn: () => libraryApi.get(id!), enabled: !!id });
  const [form, setForm] = useState<ArticleInput | null>(id ? null : { title: '', category: categories[0]?.id ?? 'marketplace-rules', body: '', pinned: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id && existing.data && !form) {
      const { title, category, body, pinned } = existing.data;
      setForm({ title, category, body, pinned });
    }
  }, [id, existing.data, form]);

  if (!form) return <p className="text-sm text-gray-500">Loading…</p>;
  const set = (patch: Partial<ArticleInput>) => setForm({ ...form, ...patch });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = id ? await libraryApi.update(id, form) : await libraryApi.create(form);
      await queryClient.invalidateQueries({ queryKey: ['library'] });
      await queryClient.invalidateQueries({ queryKey: ['library-article', res.article.articleId] });
      onDone(res.article.articleId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-lg font-semibold text-gray-900">{id ? 'Edit article' : 'New article'}</h2>
      <label className="block text-sm font-medium text-gray-700">
        Title
        <input className={field} value={form.title} maxLength={140} onChange={(e) => set({ title: e.target.value })} required />
      </label>
      <label className="block text-sm font-medium text-gray-700">
        Category
        <select className={field} value={form.category} onChange={(e) => set({ category: e.target.value })}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium text-gray-700">
        Article
        <textarea className={`${field} min-h-[280px]`} value={form.body} maxLength={20_000} onChange={(e) => set({ body: e.target.value })} required />
        <span className="mt-1 block text-xs font-normal text-gray-500">Plain text. Line breaks are kept.</span>
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={form.pinned} onChange={(e) => set({ pinned: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
        Pin to the top (most important)
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={busy || form.title.trim().length < 3 || !form.body.trim()}>
          {busy ? 'Saving…' : 'Save article'}
        </button>
        <button type="button" className={btnSecondary} disabled={busy} onClick={() => onDone(id)}>Cancel</button>
      </div>
    </form>
  );
}
