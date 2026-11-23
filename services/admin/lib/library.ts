/**
 * The staff Library: rules and things to know. In the admin table:
 *
 *   PK               SK      item
 *   ARTICLE#<id>     META    an article (GSI1: LIBRARY / <updatedAt>)
 *
 * Admin writes; Admin and Support read. A few hundred articles at most, so
 * the list is read whole and searched in memory.
 */

import { randomUUID } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config';
import { db } from './data';

export const LIBRARY_CATEGORIES = [
  { id: 'marketplace-rules', label: 'Marketplace rules' },
  { id: 'helping-sellers', label: 'How to help a seller' },
  { id: 'policies', label: 'Policies (refunds, POPIA)' },
  { id: 'replies', label: 'Ready-made replies' },
  { id: 'product-guide', label: 'MerchOS product guide' },
] as const;
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number]['id'];
export const isCategory = (v: unknown): v is LibraryCategory => LIBRARY_CATEGORIES.some((c) => c.id === v);

export interface Article {
  articleId: string;
  title: string;
  category: LibraryCategory;
  body: string;
  pinned: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export type ArticleInput = Pick<Article, 'title' | 'category' | 'body' | 'pinned'>;

const key = (id: string) => ({ PK: `ARTICLE#${id}`, SK: 'META' });

export async function listArticles(): Promise<Article[]> {
  const out: Article[] = [];
  let startKey: Record<string, unknown> | undefined;
  for (let page = 0; page < 20; page++) {
    const res = await db().send(
      new QueryCommand({
        TableName: config.adminTable,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'LIBRARY' },
        ScanIndexForward: false,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    out.push(...((res.Items ?? []) as Article[]));
    startKey = res.LastEvaluatedKey;
    if (!startKey) break;
  }
  return out.map(clean);
}

function clean(a: Article): Article {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = a as Article & Record<string, unknown>;
  return rest as unknown as Article;
}

export async function getArticle(id: string): Promise<Article | null> {
  const res = await db().send(new GetCommand({ TableName: config.adminTable, Key: key(id), ConsistentRead: true }));
  return res.Item ? clean(res.Item as Article) : null;
}

export async function saveArticle(input: ArticleInput, by: string, existing?: Article, now = new Date()): Promise<Article> {
  const at = now.toISOString();
  const article: Article = existing
    ? { ...existing, ...input, updatedAt: at, updatedBy: by }
    : { ...input, articleId: randomUUID(), createdAt: at, createdBy: by, updatedAt: at, updatedBy: by };
  await db().send(
    new PutCommand({
      TableName: config.adminTable,
      Item: { ...key(article.articleId), ...article, GSI1PK: 'LIBRARY', GSI1SK: at },
    }),
  );
  return article;
}

export async function deleteArticle(id: string): Promise<void> {
  await db().send(new DeleteCommand({ TableName: config.adminTable, Key: key(id) }));
}

/** Pinned first, then most recently updated. Search matches title and text, all words. */
export function filterArticles(articles: Article[], opts: { q?: string | undefined; category?: string | undefined }): Article[] {
  const words = (opts.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return articles
    .filter((a) => !opts.category || a.category === opts.category)
    .filter((a) => {
      if (!words.length) return true;
      const text = `${a.title}\n${a.body}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}
