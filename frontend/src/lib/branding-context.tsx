'use client';

import { createContext, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api';

export interface Branding {
  businessName: string;
  logoVersion: string | null;
  faviconVersion: string | null;
}

const DEFAULT_BRANDING: Branding = {
  businessName: 'Jai Shree Shyam Finance',
  logoVersion: null,
  faviconVersion: null,
};

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export const brandingQueryKey = ['branding'] as const;

function assetUrl(kind: 'logo' | 'favicon', version: string | null): string {
  const fallback = kind === 'logo' ? '/logo.png' : '/icon.png';
  return version
    ? `/api/v1/settings/branding/assets/${kind}?v=${encodeURIComponent(version)}`
    : fallback;
}

export function useBranding() {
  const branding = useContext(BrandingContext);
  return {
    ...branding,
    logoUrl: assetUrl('logo', branding.logoVersion),
    faviconUrl: assetUrl('favicon', branding.faviconVersion),
  };
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: brandingQueryKey,
    queryFn: () => apiGet<Branding>('/settings/branding'),
    staleTime: 60_000,
    retry: 1,
  });
  const branding = data ?? DEFAULT_BRANDING;

  useEffect(() => {
    document.title = branding.businessName;

    // Next's static app icon remains the fallback until an admin uploads one.
    // A versioned URL forces browsers to fetch the new asset after an update.
    const favicon = document.getElementById('business-favicon') as HTMLLinkElement | null
      ?? document.createElement('link');
    favicon.id = 'business-favicon';
    favicon.rel = 'icon';
    favicon.href = assetUrl('favicon', branding.faviconVersion);
    if (!favicon.isConnected) document.head.appendChild(favicon);

    const appleIcon = document.getElementById('business-apple-icon') as HTMLLinkElement | null
      ?? document.createElement('link');
    appleIcon.id = 'business-apple-icon';
    appleIcon.rel = 'apple-touch-icon';
    appleIcon.href = branding.faviconVersion
      ? assetUrl('favicon', branding.faviconVersion)
      : '/icons/apple-touch-icon.png';
    if (!appleIcon.isConnected) document.head.appendChild(appleIcon);

    const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.content = branding.businessName;
  }, [branding.businessName, branding.faviconVersion]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}
