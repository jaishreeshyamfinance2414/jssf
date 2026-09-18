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
  businessName: 'Upcoming',
  logoVersion: null,
  faviconVersion: null,
};

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export const brandingQueryKey = ['branding'] as const;

function assetUrl(kind: 'logo' | 'favicon', version: string | null): string | null {
  if (!version && kind === 'logo') return null;
  return `/api/v1/settings/branding/assets/${kind}${version ? `?v=${encodeURIComponent(version)}` : ''}`;
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

    // Next owns the metadata links. Update them in place; removing them during
    // hydration can interfere with a fresh navigation.
    const iconUrl = assetUrl('favicon', branding.faviconVersion)!;
    const iconType = branding.faviconVersion ? 'image/png' : 'image/svg+xml';
    const icons = document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]');
    if (icons.length) icons.forEach(link => { link.href = iconUrl; link.type = iconType; });
    else {
      const link = document.createElement('link');
      link.rel = 'icon'; link.type = iconType; link.href = iconUrl;
      document.head.appendChild(link);
    }
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]').forEach(link => {
      link.href = iconUrl;
    });

    const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.content = branding.businessName;
  }, [branding.businessName, branding.faviconVersion]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}
