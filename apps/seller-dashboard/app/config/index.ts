/**
 * Application configuration exports.
 */

export {
  ROUTE_PERMISSIONS,
  ROLE_HIERARCHY,
  hasRoleAccess,
  getRoutePermission,
  canAccessRoute,
  isReadOnlyForRole,
} from './route-permissions';

export type { RoutePermission } from './route-permissions';

export {
  getNotificationNavigationPath,
  isNotificationNavigable,
} from './notification-routes';
