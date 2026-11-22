'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePlatformRole } from '../hooks/usePlatformRole';

/**
 * Landing route: sends each role to the first page it can use. Support staff
 * only have the Support inbox; everyone else starts on Health (whose route
 * guard also handles signed-out visitors).
 */
export default function Home() {
  const router = useRouter();
  const { platformRole, isResolved } = usePlatformRole();

  useEffect(() => {
    if (!isResolved) return;
    router.replace(platformRole === 'Support' ? '/support' : '/health');
  }, [isResolved, platformRole, router]);

  return null;
}
