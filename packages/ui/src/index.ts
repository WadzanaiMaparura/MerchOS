// UI Component Library - Radix UI primitives + custom Tailwind wrappers

// --- Primitives ---
export {
  SkipNav,
  Modal,
  Sidebar,
  Select,
  ToastProvider,
  useToast,
  Tabs,
  ProgressBar,
} from './primitives';

export type {
  SkipNavProps,
  ModalProps,
  SidebarProps,
  SidebarItem,
  SelectProps,
  SelectOption,
  ToastProviderProps,
  ToastItem,
  ToastVariant,
  TabsProps,
  TabItem,
  ProgressBarProps,
} from './primitives';

// --- Data Display ---
export {
  Badge,
  LifecycleBadge,
  ComplianceBadge,
  ModerationBadge,
  Card,
  StatCard,
  DataTable,
} from './data-display';

export type {
  BadgeProps,
  BadgeVariant,
  LifecycleBadgeProps,
  ComplianceBadgeProps,
  ComplianceStatus,
  ModerationBadgeProps,
  CardProps,
  StatCardProps,
  DataTableProps,
  ColumnDef,
  SortDirection,
} from './data-display';

// --- Feedback ---
export { Alert, ErrorBoundary, Skeleton } from './feedback';

export type {
  AlertProps,
  AlertVariant,
  ErrorBoundaryProps,
  SkeletonProps,
} from './feedback';

// --- Forms ---
export {
  Input,
  FileUpload,
  Form,
  FormField,
  ConfirmationModal,
} from './forms';

export type {
  InputProps,
  FileUploadProps,
  FormProps,
  FormFieldProps,
  ConfirmationModalProps,
  ConfirmationVariant,
} from './forms';
