/**
 * Customers (read). Admin dashboard JWT authorizer, then RBAC `users.search` read
 * (Admin and Support).
 *
 *   GET /admin/customers?q=&filter=all|trial|paid|exempt|not_verified|disabled
 *   GET /admin/customers/{tenantId}
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import {
  CUSTOMER_FILTERS,
  countsByFilter,
  loadCustomer,
  loadCustomers,
  matchesFilter,
  matchesSearch,
  type CustomerFilter,
} from '../lib/customers';
import { UUID, badRequest, json, notFound, serverError, type HttpResult } from '../lib/http';

async function list(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const filter = (event.queryStringParameters?.['filter'] ?? 'all') as CustomerFilter;
  if (!CUSTOMER_FILTERS.includes(filter)) return badRequest('Unknown filter');
  const q = (event.queryStringParameters?.['q'] ?? '').slice(0, 100);
  const { rows } = await loadCustomers();
  const searched = rows.filter((r) => matchesSearch(r, q));
  return json(200, {
    customers: searched.filter((r) => matchesFilter(r, filter)),
    // Chip counts follow the search, so "On trial 3" means 3 matching the search.
    counts: countsByFilter(searched),
  });
}

async function detail(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const tenantId = event.pathParameters?.['tenantId'];
  if (!tenantId || !UUID.test(tenantId)) return badRequest('Invalid customer id');
  const customer = await loadCustomer(tenantId);
  if (!customer) return notFound('Customer not found');
  return json(200, { customer });
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    switch (event.routeKey) {
      case 'GET /admin/customers':
        return await list(event);
      case 'GET /admin/customers/{tenantId}':
        return await detail(event);
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Customers read failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'users.search', action: 'read' }));
