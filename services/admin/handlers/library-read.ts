/**
 * Library (read). RBAC `library` read (Admin and Support).
 *
 *   GET /admin/library?q=&category=
 *   GET /admin/library/{articleId}
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { staffDirectory } from '../lib/audit-feed';
import { UUID, badRequest, json, notFound, serverError, type HttpResult } from '../lib/http';
import { LIBRARY_CATEGORIES, filterArticles, getArticle, isCategory, listArticles, type Article } from '../lib/library';

const withEmails = (a: Article, staff: Map<string, { email: string }>) => ({
  ...a,
  updatedByEmail: staff.get(a.updatedBy)?.email ?? 'Former staff member',
});

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    switch (event.routeKey) {
      case 'GET /admin/library': {
        const category = event.queryStringParameters?.['category'] || undefined;
        if (category && !isCategory(category)) return badRequest('Unknown category');
        const q = (event.queryStringParameters?.['q'] ?? '').slice(0, 100);
        const [all, staff] = await Promise.all([listArticles(), staffDirectory()]);
        const articles = filterArticles(all, { q, category });
        return json(200, {
          articles: articles.map((a) => ({ ...withEmails(a, staff), body: a.body.slice(0, 240) })),
          categories: LIBRARY_CATEGORIES.map((c) => ({ ...c, count: all.filter((a) => a.category === c.id).length })),
          total: all.length,
        });
      }
      case 'GET /admin/library/{articleId}': {
        const id = event.pathParameters?.['articleId'];
        if (!id || !UUID.test(id)) return badRequest('Invalid article id');
        const [article, staff] = await Promise.all([getArticle(id), staffDirectory()]);
        if (!article) return notFound('Article not found');
        return json(200, { article: withEmails(article, staff) });
      }
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Library read failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'library', action: 'read' }));
