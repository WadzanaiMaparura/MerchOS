/**
 * Library (write). RBAC `library` update (Admin only). Every change goes in the Audit log.
 *
 *   POST   /admin/library                 { title, category, body, pinned }
 *   PUT    /admin/library/{articleId}     same
 *   DELETE /admin/library/{articleId}
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { recordAudit } from '../lib/audit';
import { UUID, badRequest, json, notFound, readJson, serverError, staffOf, type HttpResult } from '../lib/http';
import { LIBRARY_CATEGORIES, deleteArticle, getArticle, saveArticle } from '../lib/library';

const articleSchema = z.object({
  title: z.string().trim().min(3, 'Please add a title.').max(140),
  category: z.enum(LIBRARY_CATEGORIES.map((c) => c.id) as [string, ...string[]]),
  body: z.string().trim().min(1, 'Please write the article.').max(20_000),
  pinned: z.boolean().default(false),
});

const label = (title: string) => `Library: ${title}`;

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    const staff = staffOf(event);
    if (event.routeKey === 'POST /admin/library') {
      const parsed = articleSchema.safeParse(readJson(event, 40_000));
      if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid article');
      const article = await saveArticle(parsed.data as never, staff.userId);
      await recordAudit({ ref: `ARTICLE#${article.articleId}`, label: label(article.title) }, { action: 'article-created', by: staff.userId, byRole: staff.role });
      return json(201, { article });
    }

    const id = event.pathParameters?.['articleId'];
    if (!id || !UUID.test(id)) return badRequest('Invalid article id');
    const existing = await getArticle(id);
    if (!existing) return notFound('Article not found');

    switch (event.routeKey) {
      case 'PUT /admin/library/{articleId}': {
        const parsed = articleSchema.safeParse(readJson(event, 40_000));
        if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid article');
        const article = await saveArticle(parsed.data as never, staff.userId, existing);
        await recordAudit({ ref: `ARTICLE#${id}`, label: label(article.title) }, { action: 'article-updated', by: staff.userId, byRole: staff.role });
        return json(200, { article });
      }
      case 'DELETE /admin/library/{articleId}': {
        await deleteArticle(id);
        await recordAudit({ ref: `ARTICLE#${id}`, label: label(existing.title) }, { action: 'article-deleted', by: staff.userId, byRole: staff.role });
        return json(200, { deleted: true });
      }
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Library change failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'library', action: 'update' }));
